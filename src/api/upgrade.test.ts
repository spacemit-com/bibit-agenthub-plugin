import { describe, expect, it } from 'vitest'
import type { FeatureServiceApiV1, FeatureServiceRequestV1 } from '@bibit/feature-sdk'
import {
  ALL_AGENTS,
  POWERS_UPGRADE_OPERATION_ID,
  POWERS_UPGRADE_TIMEOUT_MS,
  UPGRADE_SCOPES,
  parseUpgradeResult,
  summarizeUpgrade,
  upgradePowers,
  type UpgradeItem,
} from './upgrade'

function makeService(respond: (callIndex: number) => unknown): {
  service: FeatureServiceApiV1<'store'>
  calls: FeatureServiceRequestV1<'store'>[]
} {
  const calls: FeatureServiceRequestV1<'store'>[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
      calls.push(input)
      return respond(calls.length - 1) as TResult
    },
  }
  return { service, calls }
}

const signal = () => new AbortController().signal

const item = (over: Partial<UpgradeItem> = {}): UpgradeItem => ({
  agent: 'bibit',
  type: 'skill',
  name: 'demo',
  currentVersion: 'v1.0.0',
  targetVersion: 'v2.0.0',
  outcome: 'upgraded',
  skip: '',
  ...over,
})

const result = (over: Record<string, unknown> = {}) => ({
  status: 'exited',
  exitCode: 0,
  items: [item()],
  reason: '',
  ...over,
})

describe('parseUpgradeResult', () => {
  it('accepts a normal run', () => {
    const parsed = parseUpgradeResult(result())
    expect(parsed.status).toBe('exited')
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0].outcome).toBe('upgraded')
  })

  it('accepts an empty item list, which is the "nothing to do" shape', () => {
    expect(parseUpgradeResult(result({ items: [] })).items).toEqual([])
  })

  it('treats an omitted skip as empty, which is how the provider sends it', () => {
    // The provider marks `skip` omitempty, so a non-skipped entry has no key.
    const { skip, ...withoutSkip } = item()
    expect(skip).toBe('')
    const parsed = parseUpgradeResult(result({ items: [withoutSkip] }))
    expect(parsed.items[0].skip).toBe('')
  })

  it('accepts empty versions, which apm reports for a skipped entry', () => {
    const parsed = parseUpgradeResult(
      result({ items: [item({ outcome: 'skipped', skip: 'not-in-catalog', targetVersion: '' })] })
    )
    expect(parsed.items[0].targetVersion).toBe('')
    expect(parsed.items[0].skip).toBe('not-in-catalog')
  })

  it('carries an outcome this build does not know instead of failing', () => {
    const parsed = parseUpgradeResult(result({ items: [item({ outcome: 'reinstalled' })] }))
    expect(parsed.items[0].outcome).toBe('reinstalled')
  })

  it('rejects a status other than exited', () => {
    expect(() => parseUpgradeResult(result({ status: 'running' }))).toThrow()
  })

  it('rejects an exit code outside 0..255', () => {
    expect(() => parseUpgradeResult(result({ exitCode: -1 }))).toThrow()
    expect(() => parseUpgradeResult(result({ exitCode: 256 }))).toThrow()
    expect(() => parseUpgradeResult(result({ exitCode: 1.5 }))).toThrow()
  })

  it('rejects an unknown top-level field', () => {
    expect(() => parseUpgradeResult(result({ stdout: 'raw' }))).toThrow(/unexpected field/)
  })

  it('rejects an unknown item field, so raw output cannot ride along', () => {
    expect(() =>
      parseUpgradeResult(result({ items: [{ ...item(), stderr: 'leak' }] }))
    ).toThrow(/unexpected field/)
  })

  it('rejects a power type outside the closed vocabulary', () => {
    expect(() => parseUpgradeResult(result({ items: [item({ type: 'binary' })] }))).toThrow(
      /invalid power type/
    )
  })

  it('rejects empty identity fields', () => {
    for (const over of [{ agent: '' }, { name: '' }, { outcome: '' }]) {
      expect(() => parseUpgradeResult(result({ items: [item(over)] }))).toThrow()
    }
  })

  it('rejects a non-array items field', () => {
    expect(() => parseUpgradeResult(result({ items: 'nope' }))).toThrow(/items must be an array/)
  })
})

describe('summarizeUpgrade', () => {
  it('counts each outcome into the bucket the page reports', () => {
    const summary = summarizeUpgrade([
      item({ outcome: 'upgraded' }),
      item({ outcome: 'installed' }),
      item({ outcome: 'downgraded' }),
      item({ outcome: 'up-to-date' }),
      item({ outcome: 'skipped' }),
      item({ outcome: 'failed' }),
      item({ outcome: 'unexecuted' }),
    ])
    expect(summary).toEqual({ changed: 3, unchanged: 2, failed: 2 })
  })

  it('counts an unknown outcome as changed rather than losing it', () => {
    // Under-reporting a change is worse than labelling it imprecisely: the user
    // is told something happened and can look at the list.
    expect(summarizeUpgrade([item({ outcome: 'reinstalled' })])).toEqual({
      changed: 1,
      unchanged: 0,
      failed: 0,
    })
  })

  it('counts a dry-run plan as unchanged, so it can never claim a change', () => {
    expect(summarizeUpgrade([item({ outcome: 'planned' })]).unchanged).toBe(1)
  })

  it('is all zeroes for an empty run', () => {
    expect(summarizeUpgrade([])).toEqual({ changed: 0, unchanged: 0, failed: 0 })
  })
})

describe('upgradePowers', () => {
  it('invokes powers.upgrade.v1 with the scope and the maximum budget', async () => {
    const { service, calls } = makeService(() => result())
    await upgradePowers(service, 'bibit', signal())

    expect(calls).toHaveLength(1)
    expect(calls[0].operationId).toBe(POWERS_UPGRADE_OPERATION_ID)
    expect(calls[0].params).toEqual({ agent: 'bibit' })
    // The registry drop-in carries the same ceiling; the Host takes the smaller
    // of the two, which is why both are the maximum.
    expect(calls[0].timeoutMs).toBe(POWERS_UPGRADE_TIMEOUT_MS)
    expect(POWERS_UPGRADE_TIMEOUT_MS).toBe(300_000)
  })

  it('passes apm\'s all sentinel through unchanged', async () => {
    const { service, calls } = makeService(() => result({ items: [] }))
    await upgradePowers(service, ALL_AGENTS, signal())
    expect(calls[0].params).toEqual({ agent: 'all' })
  })

  it('offers the whole machine plus every installed Agent, with all first', () => {
    expect(UPGRADE_SCOPES[0]).toBe('all')
    expect([...UPGRADE_SCOPES].sort()).toEqual(
      ['all', 'bibit', 'claude-code', 'codex', 'hermes-agent'].sort()
    )
  })

  it('keeps a non-zero exit code as a result rather than throwing', async () => {
    // apm renders the full result before failing a batch: the code and the items
    // together are the account of what happened.
    const { service } = makeService(() => result({ exitCode: 1, items: [item({ outcome: 'failed' })] }))
    const parsed = await upgradePowers(service, 'bibit', signal())
    expect(parsed.exitCode).toBe(1)
    expect(parsed.items[0].outcome).toBe('failed')
  })

  it('surfaces the provider reason when there are no items', async () => {
    const { service } = makeService(() =>
      result({ exitCode: 1, items: [], reason: 'APM lock is already held' })
    )
    const parsed = await upgradePowers(service, 'bibit', signal())
    expect(parsed.items).toEqual([])
    expect(parsed.reason).toBe('APM lock is already held')
  })

  it('turns an aborted request into a cancelled platform error', async () => {
    const controller = new AbortController()
    controller.abort()
    const { service } = makeService(() => result())
    await expect(upgradePowers(service, 'bibit', controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    })
  })
})
