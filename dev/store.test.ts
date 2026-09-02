import { describe, expect, it, vi } from 'vitest'
import type { ListPowersInput } from '../src/api/contracts'
import {
  buildMarketResult,
  handleStoreRequest,
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

describe('buildMarketResult', () => {
  it('aggregates skill fixtures with sorted tags facet', () => {
    const result = buildMarketResult(marketQuery())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((s) => s.name)).toEqual(['transcribe', 'translate'])
    expect(result.total).toBe(2)
    expect(result.snapshot).toBe('local-preview-v1')
    expect(result.facets.agents).toEqual([])
    expect(result.facets.tags).toEqual(['transcribe', 'translate', 'writing'])
  })

  it('filters market fixtures by type', () => {
    const result = buildMarketResult(marketQuery({ type: 'plugin' }))
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((s) => s.name)).toEqual(['cache-warm'])
    expect(result.facets.tags).toEqual(['perf'])
  })
})

describe('handleStoreRequest', () => {
  it('returns default settings for settings.get.v1', async () => {
    await expect(handleStoreRequest({ operationId: 'settings.get.v1', params: {} }, okRunner))
      .resolves.toEqual({ showExperimental: false, refreshMinutes: 15 })
  })

  it('echoes settings.update.v1 and persists the change', async () => {
    const next = { showExperimental: true, refreshMinutes: 30 }
    await expect(
      handleStoreRequest({ operationId: 'settings.update.v1', params: next }, okRunner)
    ).resolves.toEqual(next)
    await expect(handleStoreRequest({ operationId: 'settings.get.v1', params: {} }, okRunner))
      .resolves.toEqual(next)
  })

  it('serves the market scope without invoking apm', async () => {
    const runApm = vi.fn<ApmRunner>(async () => ({ status: 'ok', records: [] }))
    const result = await handleStoreRequest(
      { operationId: 'powers.list.v1', params: marketQuery() },
      runApm,
    )
    expect(result).toMatchObject({ status: 'ready', snapshot: 'local-preview-v1' })
    expect(runApm).not.toHaveBeenCalled()
  })

  it('invokes apm for the selected agent and renders its records', async () => {
    const runApm = vi.fn<ApmRunner>(async (agent) => ({
      status: 'ok',
      records: [{ agent, type: 'skill', name: 'demo', version: 'v1.0.0', tags: ['x'] }],
    }))
    const result = await handleStoreRequest(
      { operationId: 'powers.list.v1', params: installedParams() },
      runApm,
    )
    expect(runApm).toHaveBeenCalledWith('bibit')
    expect(result).toMatchObject({ status: 'ready', total: 1, items: [{ name: 'demo' }] })
  })

  it('maps apm unavailability to a retryable unavailable error', async () => {
    const runApm: ApmRunner = async () => ({ status: 'unavailable' })
    await expect(
      handleStoreRequest({ operationId: 'powers.list.v1', params: installedParams() }, runApm),
    ).rejects.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('renders an empty ready result when apm reports not-installed', async () => {
    const runApm: ApmRunner = async () => ({ status: 'not-installed' })
    const result = await handleStoreRequest(
      { operationId: 'powers.list.v1', params: installedParams() },
      runApm,
    )
    expect(result).toMatchObject({ status: 'ready', items: [], total: 0, facets: { agents: [], tags: [] } })
  })

  it('rejects unknown operations as incompatible', async () => {
    await expect(
      handleStoreRequest({ operationId: 'nope.v1', params: {} }, okRunner),
    ).rejects.toMatchObject({ code: 'incompatible' })
  })

  it('rejects installed requests without an agent', async () => {
    const params = { ...installedParams() }
    delete params.agent
    await expect(
      handleStoreRequest({ operationId: 'powers.list.v1', params }, okRunner),
    ).rejects.toThrow(/agent is required/)
  })
})