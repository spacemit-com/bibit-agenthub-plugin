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
    const { service, calls } = makeService(() => ({
      scope: 'installed',
      status: 'data',
      listJson,
    }))

    const result = await listPowers(service, installedInput, signal())

    expect(calls).toHaveLength(1)
    expect(calls[0].params).toEqual({ scope: 'installed', agent: 'bibit' })
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

  it('keeps the installed cache isolated per agent', async () => {
    const { service, calls } = makeService(() => ({ scope: 'installed', status: 'data', listJson: '[]' }))

    await listPowers(service, installedInput, signal())
    await listPowers(service, { ...installedInput, agent: 'codex' }, signal())

    expect(calls[0].params).toEqual({ scope: 'installed', agent: 'bibit' })
    expect(calls[1].params).toEqual({ scope: 'installed', agent: 'codex' })
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
