import { describe, expect, it } from 'vitest'
import type {
  FeatureServiceApiV1,
  FeatureServiceErrorV1,
  FeatureServiceRequestV1,
} from '@bibit/feature-sdk'
import type { ListPowersInput } from './contracts'
import { listPowers } from './powerCatalogClient'

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const catalogJson = JSON.stringify({
  skills: {
    items: [{ name: 'demo', version: 'v1.0.0', description: 'a demo', tags: ['quality'] }],
  },
})

const marketInput: ListPowersInput = {
  scope: 'market',
  type: 'skill',
  tags: [],
  page: 1,
  pageSize: 20,
}

const installedInput: ListPowersInput = {
  scope: 'installed',
  agent: 'bibit',
  type: 'skill',
  tags: [],
  page: 1,
  pageSize: 20,
}

function makeService(
  respond: (callIndex: number, input: FeatureServiceRequestV1<'store'>) => unknown
): {
  service: FeatureServiceApiV1<'store'>
  calls: FeatureServiceRequestV1<'store'>[]
} {
  const calls: FeatureServiceRequestV1<'store'>[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
      calls.push(input)
      return respond(calls.length - 1, input) as TResult
    },
  }
  return { service, calls }
}

const signal = () => new AbortController().signal

describe('listPowers', () => {
  it('sends a bare market request on first load and parses the result', async () => {
    const snapshot = await sha256(catalogJson)
    const { service, calls } = makeService(() => ({
      scope: 'market',
      status: 'data',
      snapshot,
      catalogJson,
    }))

    const result = await listPowers(service, marketInput, signal())

    expect(calls).toHaveLength(1)
    expect(calls[0].params).toEqual({ scope: 'market' })
    expect(calls[0].operationId).toBe('powers.list.v1')
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.snapshot).toBe(snapshot)
    expect(result.items).toHaveLength(1)
  })

  it('sends the cached snapshot as knownSnapshot on the second market request', async () => {
    const snapshot = await sha256(catalogJson)
    const { service, calls } = makeService((index) =>
      index === 0
        ? { scope: 'market', status: 'data', snapshot, catalogJson }
        : { scope: 'market', status: 'not_modified', snapshot }
    )

    await listPowers(service, marketInput, signal())
    const result = await listPowers(service, marketInput, signal())

    expect(calls).toHaveLength(2)
    expect(calls[1].params).toEqual({ scope: 'market', knownSnapshot: snapshot })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.snapshot).toBe(snapshot)
    expect(result.items).toHaveLength(1)
  })

  it('serves not_modified from the held cache without re-parsing a catalog', async () => {
    const snapshot = await sha256(catalogJson)
    const { service } = makeService((index) =>
      index === 0
        ? { scope: 'market', status: 'data', snapshot, catalogJson }
        : { scope: 'market', status: 'not_modified', snapshot }
    )

    await listPowers(service, marketInput, signal())
    const result = await listPowers(service, marketInput, signal())

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items).toHaveLength(1)
  })

  it('sends the agent for installed and re-parses the raw list each time', async () => {
    const listJson = JSON.stringify([
      { agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0', description: 'installed', tags: ['alpha'] },
    ])
    const { service, calls } = makeService((index, input) =>
      input.operationId === 'powers.custom.list.v1'
        ? { scope: 'custom', status: 'data', itemsJson: '{"items":[],"skipped":[]}' }
        : { scope: 'installed', status: 'data', listJson }
    )

    const result = await listPowers(service, installedInput, signal())

    // One request reads the APM manifest, one scans for hand-installed resources.
    expect(calls).toHaveLength(2)
    expect(calls[0].params).toEqual({ scope: 'installed', agent: 'bibit' })
    expect(calls[1].operationId).toBe('powers.custom.list.v1')
    expect(calls[1].params).toEqual({ agent: 'bibit' })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items).toHaveLength(1)
    expect(result.items[0].versions[0].description).toBe('installed')
  })

  it('rejects a hash mismatch as retryable unavailable and does not commit', async () => {
    const validSnapshot = await sha256(catalogJson)
    const { service, calls } = makeService((index) =>
      index === 0
        ? { scope: 'market', status: 'data', snapshot: 'deadbeef', catalogJson }
        : { scope: 'market', status: 'data', snapshot: validSnapshot, catalogJson }
    )

    await expect(listPowers(service, marketInput, signal())).rejects.toMatchObject({
      version: 1,
      code: 'unavailable',
      retryable: true,
    })

    // The failed request must not have committed, so the next request is still bare.
    await listPowers(service, marketInput, signal())
    expect(calls[1].params).toEqual({ scope: 'market' })
  })

  it('rejects a wrong result scope as incompatible', async () => {
    const { service } = makeService(() => ({ scope: 'market', status: 'data', snapshot: 'x', catalogJson }))
    await expect(listPowers(service, installedInput, signal())).rejects.toMatchObject({
      code: 'incompatible',
    })
  })

  it('rejects not_modified without a matching cache', async () => {
    const { service } = makeService(() => ({ scope: 'market', status: 'not_modified', snapshot: 'ghost' }))
    await expect(listPowers(service, marketInput, signal())).rejects.toMatchObject({
      code: 'incompatible',
    })
  })

  it('keeps the market cache isolated per service instance', async () => {
    const snapshot = await sha256(catalogJson)
    const first = makeService(() => ({ scope: 'market', status: 'data', snapshot, catalogJson }))
    const second = makeService(() => ({ scope: 'market', status: 'data', snapshot, catalogJson }))

    await listPowers(first.service, marketInput, signal())
    await listPowers(second.service, marketInput, signal())

    expect(first.calls[0].params).toEqual({ scope: 'market' })
    expect(second.calls[0].params).toEqual({ scope: 'market' })
  })

  it('answers a superseded request from the newer cache instead of cancelling', async () => {
    const snapshotA = await sha256(catalogJson)
    const catalogJsonB = JSON.stringify({
      skills: {
        items: [{ name: 'newer', version: 'v2.0.0', description: 'newer', tags: [] }],
      },
    })
    const snapshotB = await sha256(catalogJsonB)

    let resolveSlow: ((value: unknown) => void) | undefined
    let resolveFast: ((value: unknown) => void) | undefined
    const { service, calls } = makeService((index) => {
      if (index === 0) return new Promise((resolve) => { resolveSlow = resolve })
      if (index === 1) return new Promise((resolve) => { resolveFast = resolve })
      return { scope: 'market', status: 'not_modified', snapshot: snapshotB }
    })

    const slow = listPowers(service, marketInput, signal())
    const fast = listPowers(service, marketInput, signal())

    // The fast request commits first and bumps the generation.
    resolveFast!({ scope: 'market', status: 'data', snapshot: snapshotB, catalogJson: catalogJsonB })
    await fast

    // The slow request must neither overwrite the newer cache nor fail: being
    // superseded is not a user-visible cancellation, so it answers from the
    // fresher catalog instead.
    resolveSlow!({ scope: 'market', status: 'data', snapshot: snapshotA, catalogJson })
    const superseded = await slow

    expect(superseded.status).toBe('ready')
    if (superseded.status !== 'ready') return
    expect(superseded.snapshot).toBe(snapshotB)
    expect(superseded.items.map((series) => series.name)).toEqual(['newer'])

    // The cache still holds snapshotB, so a third request sends it and succeeds.
    const result = await listPowers(service, marketInput, signal())
    expect(calls[2].params).toEqual({ scope: 'market', knownSnapshot: snapshotB })
    expect(result.status).toBe('ready')
  })

  it('returns reset_required when page 2 arrives with a changed snapshot', async () => {
    const snapshotA = await sha256(catalogJson)
    const catalogJsonB = JSON.stringify({
      skills: { items: [{ name: 'newer', version: 'v2.0.0', description: 'newer', tags: [] }] },
    })
    const snapshotB = await sha256(catalogJsonB)
    const { service } = makeService((index) =>
      index === 0
        ? { scope: 'market', status: 'data', snapshot: snapshotA, catalogJson }
        : { scope: 'market', status: 'data', snapshot: snapshotB, catalogJson: catalogJsonB }
    )

    await listPowers(service, marketInput, signal())
    const pageTwo: ListPowersInput = { ...marketInput, page: 2, snapshot: snapshotA }
    const result = await listPowers(service, pageTwo, signal())

    expect(result.status).toBe('reset_required')
  })

  it('sends knownSnapshot on a filtered request without leaking filter params', async () => {
    const snapshot = await sha256(catalogJson)
    const { service, calls } = makeService((index) =>
      index === 0
        ? { scope: 'market', status: 'data', snapshot, catalogJson }
        : { scope: 'market', status: 'not_modified', snapshot }
    )

    await listPowers(service, marketInput, signal())
    await listPowers(service, { ...marketInput, type: 'plugin', tags: ['perf'] }, signal())

    expect(calls[1].params).toEqual({ scope: 'market', knownSnapshot: snapshot })
  })

  it('searches the full market and its cached catalog without sending search to the Provider', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      name: `a-${index.toString().padStart(2, '0')}`, version: 'v1.0.0', description: 'Unrelated', tags: [],
    }))
    const catalog = JSON.stringify({ skills: { items: [
      ...items,
      { name: 'z-report', name_zh: '分析报告', name_en: 'Data Report', version: 'v2.0.0', description: 'Summary', description_zh: '汇总数据', tags: ['data'] },
      { name: 'z-report', version: 'v1.0.0', description: 'Legacy analysis', tags: ['data'] },
    ] } })
    const snapshot = await sha256(catalog)
    const { service, calls } = makeService((index) => index === 0
      ? { scope: 'market', status: 'data', snapshot, catalogJson: catalog }
      : { scope: 'market', status: 'not_modified', snapshot }
    )

    const first = await listPowers(service, marketInput, signal(), { search: '  DATA REPORT  ' })
    expect(first.status).toBe('ready')
    if (first.status !== 'ready') return
    expect(first.items.map((item) => item.name)).toEqual(['z-report'])
    expect(first.items[0].versions.map((version) => version.version)).toEqual(['v2.0.0', 'v1.0.0'])
    expect(first.total).toBe(1)
    expect(calls[0].params).toEqual({ scope: 'market' })

    const cached = await listPowers(service, marketInput, signal(), { search: '汇总数据' })
    expect(cached).toEqual(first)
    expect(calls[1].params).toEqual({ scope: 'market', knownSnapshot: snapshot })

    const restored = await listPowers(service, marketInput, signal(), { search: '' })
    expect(restored.status).toBe('ready')
    if (restored.status !== 'ready') return
    expect(restored.total).toBe(26)
    expect(restored.items).toHaveLength(20)
  })

  it('applies tag intersection to the market catalog', async () => {
    // The market path funnels through the same `buildPowersResult`, so the AND
    // rule has to hold there too: two tags must not behave like either one.
    const catalog = JSON.stringify({
      skills: {
        items: [
          { name: 'both', version: 'v1.0.0', description: '', tags: ['alpha', 'beta'] },
          { name: 'alpha-only', version: 'v1.0.0', description: '', tags: ['alpha'] },
          { name: 'beta-only', version: 'v1.0.0', description: '', tags: ['beta'] },
        ],
      },
    })
    const snapshot = await sha256(catalog)
    const { service } = makeService(() => ({ scope: 'market', status: 'data', snapshot, catalogJson: catalog }))

    const one = await listPowers(service, { ...marketInput, tags: ['alpha'] }, signal())
    expect(one.status).toBe('ready')
    if (one.status !== 'ready') return
    expect(one.items.map((series) => series.name)).toEqual(['alpha-only', 'both'])

    const two = await listPowers(service, { ...marketInput, tags: ['alpha', 'beta'] }, signal())
    expect(two.status).toBe('ready')
    if (two.status !== 'ready') return
    expect(two.items.map((series) => series.name)).toEqual(['both'])
  })

  it('keeps the installed cache isolated per agent', async () => {
    const { service, calls } = makeService((_index, input) =>
      input.operationId === 'powers.custom.list.v1'
        ? { scope: 'custom', status: 'data', itemsJson: '{"items":[],"skipped":[]}' }
        : { scope: 'installed', status: 'data', listJson: '[]' }
    )

    await listPowers(service, installedInput, signal())
    await listPowers(service, { ...installedInput, agent: 'codex' }, signal())

    const listCalls = calls.filter((call) => call.operationId === 'powers.list.v1')
    expect(listCalls[0].params).toEqual({ scope: 'installed', agent: 'bibit' })
    expect(listCalls[1].params).toEqual({ scope: 'installed', agent: 'codex' })
  })

  it('does not commit when the signal is already aborted', async () => {
    const snapshot = await sha256(catalogJson)
    const controller = new AbortController()
    controller.abort()
    const { service, calls } = makeService(() => ({
      scope: 'market',
      status: 'data',
      snapshot,
      catalogJson,
    }))

    await expect(listPowers(service, marketInput, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    })

    // Nothing was committed, so a fresh request is still bare.
    await listPowers(service, marketInput, signal())
    expect(calls[1].params).toEqual({ scope: 'market' })
  })

  it('preserves a FeatureServiceError rejected by the service as-is', async () => {
    const error: FeatureServiceErrorV1 = {
      version: 1,
      code: 'unavailable',
      message: 'store is down',
      retryable: true,
      diagnosticId: 'diag-1',
    }
    const { service } = makeService(() => {
      throw error
    })

    const caught = await listPowers(service, marketInput, signal()).catch((reason: unknown) => reason)
    expect(caught).toBe(error)
  })
})

describe('listPowers custom merge', () => {
  const installedWith = (listJson: string, itemsJson: string) =>
    makeService((_index, input) =>
      input.operationId === 'powers.custom.list.v1'
        ? { scope: 'custom', status: 'data', itemsJson }
        : { scope: 'installed', status: 'data', listJson }
    )

  const hubRecord = { agent: 'bibit', type: 'skill', name: 'hub-skill', version: 'v1.0.0', description: 'hub', tags: [] }
  const customItem = {
    type: 'skill',
    name: 'hand-written',
    version: '',
    description: 'Hand made.',
    tags: [],
    source: 'custom',
  }

  it('lists Hub and hand-installed resources together, marked with their source', async () => {
    const { service } = installedWith(
      JSON.stringify([hubRecord]),
      JSON.stringify({ items: [customItem], skipped: [] })
    )
    const result = await listPowers(service, installedInput, signal())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((series) => series.name)).toEqual(['hand-written', 'hub-skill'])
    expect(result.items.find((series) => series.name === 'hand-written')?.source).toBe('custom')
    expect(result.items.find((series) => series.name === 'hub-skill')?.source).toBeUndefined()
    expect(result.warnings).toEqual([])
  })

  it('searches the installed and custom merged list without changing either request contract', async () => {
    const { service, calls } = installedWith(
      JSON.stringify([hubRecord]),
      JSON.stringify({ items: [{ ...customItem, name_zh: '本地文档', description_zh: '整理文件' }], skipped: [] })
    )
    const result = await listPowers(service, installedInput, signal(), { search: '本地文档' })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((item) => item.name)).toEqual(['hand-written'])
    expect(result.items[0].source).toBe('custom')
    expect(calls.map((call) => call.params)).toEqual([
      { scope: 'installed', agent: 'bibit' },
      { agent: 'bibit' },
    ])
  })

  it('prefers the APM manifest when a hand-installed directory has the same name', async () => {
    const { service } = installedWith(
      JSON.stringify([{ ...hubRecord, name: 'hand-written' }]),
      JSON.stringify({ items: [customItem], skipped: [] })
    )
    const result = await listPowers(service, installedInput, signal())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items).toHaveLength(1)
    expect(result.items[0].source).toBeUndefined()
    expect(result.items[0].versions[0].description).toBe('hub')
  })

  it('turns scan skips into readable warnings without dropping the Hub list', async () => {
    const { service } = installedWith(
      JSON.stringify([hubRecord]),
      JSON.stringify({
        items: [],
        skipped: [
          { type: 'skill', name: 'partial', expected: 'SKILL.md', reason: 'invalid-authority-file' },
          { type: 'plugin', name: 'container', expected: 'apc-plugin.json', reason: 'missing-authority-file' },
        ],
      })
    )
    const result = await listPowers(service, installedInput, signal())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((series) => series.name)).toEqual(['hub-skill'])
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings[0]).toMatchObject({
      code: 'custom-resource-skipped',
      agent: 'bibit',
      message: 'Skipped {type} "{name}": its {expected} does not meet the minimum format.',
      values: { type: 'skill', name: 'partial', expected: 'SKILL.md' },
    })
    expect(result.warnings[1].message).toBe('Skipped {type} "{name}": {expected} is missing.')
  })

  it('drops skip warnings for a directory the APM manifest already manages', async () => {
    // A Hub-managed Power is installed into the same directory the scanner
    // walks, so a scanner quirk that rejects its authority file must not produce
    // a warning about a card the manifest already feeds correctly.
    const { service } = installedWith(
      JSON.stringify([hubRecord]),
      JSON.stringify({
        items: [],
        skipped: [
          { type: 'skill', name: 'hub-skill', expected: 'SKILL.md', reason: 'invalid-authority-file' },
          { type: 'skill', name: 'partial', expected: 'SKILL.md', reason: 'invalid-authority-file' },
        ],
      })
    )
    const result = await listPowers(service, installedInput, signal())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((series) => series.name)).toEqual(['hub-skill'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].values).toEqual({ type: 'skill', name: 'partial', expected: 'SKILL.md' })
  })

  it('degrades a failed scan to one warning instead of failing the installed view', async () => {
    const { service } = makeService((_index, input) => {
      if (input.operationId === 'powers.custom.list.v1') {
        // A provider that predates the custom operation answers incompatible.
        throw { version: 1, code: 'incompatible', message: 'unknown operation', retryable: false }
      }
      return { scope: 'installed', status: 'data', listJson: JSON.stringify([hubRecord]) }
    })
    const result = await listPowers(service, installedInput, signal())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((series) => series.name)).toEqual(['hub-skill'])
    expect(result.warnings).toEqual([
      {
        code: 'custom-resources-unavailable',
        agent: 'bibit',
        message: 'Custom resources could not be scanned for this Agent.',
      },
    ])
  })

  it('still propagates a cancellation of the whole read', async () => {
    const controller = new AbortController()
    const { service } = makeService((_index, input) => {
      if (input.operationId === 'powers.custom.list.v1') {
        controller.abort()
        throw { version: 1, code: 'cancelled', message: 'cancelled', retryable: false }
      }
      return { scope: 'installed', status: 'data', listJson: '[]' }
    })
    await expect(installedRequest(service, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
  })
})

function installedRequest(service: FeatureServiceApiV1<'store'>, signal: AbortSignal) {
  return listPowers(service, installedInput, signal)
}
