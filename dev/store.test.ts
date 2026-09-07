import { describe, expect, it, vi } from 'vitest'
import type { ListPowersInput, ListPowersResult } from '../src/api/contracts'
import type { PowerRecord } from '../src/api/apm'
import {
  handleStoreRequest,
  type ApcCatalogRunner,
  type ApmRunner,
} from './store'

function marketQuery(overrides: Partial<ListPowersInput> = {}): ListPowersInput {
  return { scope: 'market', type: 'skill', tags: [], page: 1, pageSize: 20, ...overrides }
}

function installedParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: 'installed',
    agent: 'bibit',
    type: 'skill',
    tags: [],
    page: 1,
    pageSize: 20,
    ...overrides,
  }
}

const okRunner: ApmRunner = async () => ({ status: 'ok', records: [] })

const okApcRunner: ApcCatalogRunner = async () => ({
  status: 'ok',
  snapshot: 'catalog-sha-1',
  records: [],
})

const marketRecords: PowerRecord[] = [
  { type: 'skill', name: 'transcribe', version: 'v1.3.0', description: 'Transcribes audio.', tags: ['transcribe'] },
  { type: 'skill', name: 'translate', version: 'v2.0.0', description: 'Translates text.', tags: ['translate', 'writing'] },
  { type: 'plugin', name: 'cache-warm', version: 'v1.0.0', description: 'Warms caches.', tags: ['perf'] },
]

describe('handleStoreRequest', () => {
  it('returns default settings for settings.get.v1', async () => {
    await expect(
      handleStoreRequest({ operationId: 'settings.get.v1', params: {} }, okRunner, okApcRunner)
    ).resolves.toEqual({ showExperimental: false, refreshMinutes: 15 })
  })

  it('echoes settings.update.v1 and persists the change', async () => {
    const next = { showExperimental: true, refreshMinutes: 30 }
    await expect(
      handleStoreRequest({ operationId: 'settings.update.v1', params: next }, okRunner, okApcRunner)
    ).resolves.toEqual(next)
    await expect(
      handleStoreRequest({ operationId: 'settings.get.v1', params: {} }, okRunner, okApcRunner)
    ).resolves.toEqual(next)
  })

  it('serves the market scope from the APC catalog without invoking apm', async () => {
    const runApm = vi.fn<ApmRunner>(async () => ({ status: 'ok', records: [] }))
    const runApcCatalog = vi.fn<ApcCatalogRunner>(async () => ({
      status: 'ok',
      snapshot: 'catalog-sha-1',
      records: marketRecords,
    }))
    const result = await handleStoreRequest(
      { operationId: 'powers.list.v1', params: marketQuery() },
      runApm,
      runApcCatalog,
    )
    expect(result).toMatchObject({
      status: 'ready',
      snapshot: 'catalog-sha-1',
      items: [{ name: 'transcribe' }, { name: 'translate' }],
      total: 2,
      facets: { agents: [], tags: ['transcribe', 'translate', 'writing'] },
    })
    expect(runApcCatalog).toHaveBeenCalledTimes(1)
    expect(runApm).not.toHaveBeenCalled()
  })

  it('filters the APC catalog by type on each market request', async () => {
    const runApcCatalog = vi.fn<ApcCatalogRunner>(async () => ({
      status: 'ok',
      snapshot: 'catalog-sha-1',
      records: marketRecords,
    }))
    const result = await handleStoreRequest(
      { operationId: 'powers.list.v1', params: marketQuery({ type: 'plugin' }) },
      okRunner,
      runApcCatalog,
    )
    expect(result).toMatchObject({
      status: 'ready',
      items: [{ name: 'cache-warm' }],
      total: 1,
      facets: { agents: [], tags: ['perf'] },
    })
  })

  it('re-fetches the APC catalog on every market request (no caching)', async () => {
    const runApcCatalog = vi.fn<ApcCatalogRunner>(async () => ({
      status: 'ok',
      snapshot: 'catalog-sha-1',
      records: marketRecords,
    }))
    await handleStoreRequest(
      { operationId: 'powers.list.v1', params: marketQuery() },
      okRunner,
      runApcCatalog,
    )
    await handleStoreRequest(
      { operationId: 'powers.list.v1', params: marketQuery({ page: 2, snapshot: 'catalog-sha-1' }) },
      okRunner,
      runApcCatalog,
    )
    expect(runApcCatalog).toHaveBeenCalledTimes(2)
  })

  it('maps APC catalog unavailability to a retryable unavailable error', async () => {
    const runApcCatalog: ApcCatalogRunner = async () => ({ status: 'unavailable' })
    await expect(
      handleStoreRequest(
        { operationId: 'powers.list.v1', params: marketQuery() },
        okRunner,
        runApcCatalog,
      )
    ).rejects.toMatchObject({ code: 'unavailable', retryable: true, message: 'APC catalog is unavailable' })
  })

  it('invokes apm for the selected agent and renders its identity-only records without invoking APC', async () => {
    const runApm = vi.fn<ApmRunner>(async (agent) => ({
      status: 'ok',
      records: [{ agent, type: 'skill', name: 'demo', version: 'v1.0.0' }],
    }))
    const runApcCatalog = vi.fn<ApcCatalogRunner>(okApcRunner)
    const result = await handleStoreRequest(
      { operationId: 'powers.list.v1', params: installedParams() },
      runApm,
      runApcCatalog,
    )
    expect(runApm).toHaveBeenCalledWith('bibit')
    expect(runApcCatalog).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'ready',
      total: 1,
      items: [{ name: 'demo' }],
      facets: { agents: [], tags: [] },
    })
    const ready = result as ListPowersResult
    if (ready.status !== 'ready') return
    expect(ready.items[0].versions[0]).toEqual({ version: 'v1.0.0', description: '', tags: [] })
  })

  it('maps apm unavailability to a retryable unavailable error', async () => {
    const runApm: ApmRunner = async () => ({ status: 'unavailable' })
    await expect(
      handleStoreRequest(
        { operationId: 'powers.list.v1', params: installedParams() },
        runApm,
        okApcRunner,
      )
    ).rejects.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('renders an empty ready result when apm reports not-installed', async () => {
    const runApm: ApmRunner = async () => ({ status: 'not-installed' })
    const result = await handleStoreRequest(
      { operationId: 'powers.list.v1', params: installedParams() },
      runApm,
      okApcRunner,
    )
    expect(result).toMatchObject({ status: 'ready', items: [], total: 0, facets: { agents: [], tags: [] } })
  })

  it('rejects unknown operations as incompatible', async () => {
    await expect(
      handleStoreRequest({ operationId: 'nope.v1', params: {} }, okRunner, okApcRunner)
    ).rejects.toMatchObject({ code: 'incompatible' })
  })

  it('rejects installed requests without an agent', async () => {
    const params = { ...installedParams() }
    delete params.agent
    await expect(
      handleStoreRequest({ operationId: 'powers.list.v1', params }, okRunner, okApcRunner)
    ).rejects.toThrow(/agent is required/)
  })
})
