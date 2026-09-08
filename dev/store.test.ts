import { describe, expect, it, vi } from 'vitest'
import type { FeatureServiceApiV1, FeatureServiceRequestV1 } from '@bibit/feature-sdk'
import type { ListPowersInput } from '../src/api/contracts'
import { listPowers } from '../src/api/powerCatalogClient'
import {
  handleStoreRequest,
  type InspectSource,
  type InstalledSource,
  type MarketSource,
  type MutateSource,
  type StoreSources,
} from './store'

const marketWire = { scope: 'market' }
const installedWire = { scope: 'installed', agent: 'bibit' }

const okInstalled: InstalledSource = async () => ({ scope: 'installed', status: 'data', listJson: '[]' })
const okMarket: MarketSource = async () => ({
  scope: 'market',
  status: 'data',
  snapshot: 'sha-1',
  catalogJson: '{}',
})
const okInspect: InspectSource = async () => ({ listJson: '[]' })
const okMutate: MutateSource = async () => ({ status: 'exited', exitCode: 0 })

function sources(overrides: Partial<StoreSources> = {}): StoreSources {
  return { readInstalled: okInstalled, readMarket: okMarket, inspect: okInspect, mutate: okMutate, ...overrides }
}

function marketQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...marketWire, ...overrides }
}

describe('handleStoreRequest', () => {
  it('returns default settings for settings.get.v1', async () => {
    await expect(
      handleStoreRequest({ operationId: 'settings.get.v1', params: {} }, sources(), new AbortController().signal)
    ).resolves.toEqual({ showExperimental: false, refreshMinutes: 15 })
  })

  it('echoes settings.update.v1 and persists the change', async () => {
    const next = { showExperimental: true, refreshMinutes: 30 }
    await expect(
      handleStoreRequest({ operationId: 'settings.update.v1', params: next }, sources(), new AbortController().signal)
    ).resolves.toEqual(next)
    await expect(
      handleStoreRequest({ operationId: 'settings.get.v1', params: {} }, sources(), new AbortController().signal)
    ).resolves.toEqual(next)
  })

  it('passes the market wire through to the source and returns the raw envelope', async () => {
    const readMarket = vi.fn<MarketSource>(okMarket)
    const result = await handleStoreRequest(
      { operationId: 'powers.list.v1', params: marketWire },
      sources({ readMarket }),
      new AbortController().signal
    )
    expect(readMarket).toHaveBeenCalledWith(undefined, expect.any(AbortSignal))
    expect(result).toEqual({ scope: 'market', status: 'data', snapshot: 'sha-1', catalogJson: '{}' })
  })

  it('passes the installed wire through to the source with its agent', async () => {
    const readInstalled = vi.fn<InstalledSource>(okInstalled)
    const result = await handleStoreRequest(
      { operationId: 'powers.list.v1', params: installedWire },
      sources({ readInstalled }),
      new AbortController().signal
    )
    expect(readInstalled).toHaveBeenCalledWith('bibit', expect.any(AbortSignal))
    expect(result).toEqual({ scope: 'installed', status: 'data', listJson: '[]' })
  })

  it('rejects unknown operations as incompatible', async () => {
    await expect(
      handleStoreRequest({ operationId: 'nope.v1', params: {} }, sources(), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'incompatible' })
  })

  it('rejects an installed wire without an agent', async () => {
    await expect(
      handleStoreRequest({ operationId: 'powers.list.v1', params: { scope: 'installed' } }, sources(), new AbortController().signal)
    ).rejects.toThrow(/Invalid powers\.list\.v1/)
  })

  it('rejects a wire result outside the closed union', async () => {
    const readMarket: MarketSource = async () => ({ scope: 'market', status: 'weird' }) as never
    await expect(
      handleStoreRequest({ operationId: 'powers.list.v1', params: marketWire }, sources({ readMarket }), new AbortController().signal)
    ).rejects.toThrow(/Invalid powers\.list\.v1/)
  })

  it('routes inspect to the source with the parsed target', async () => {
    const inspect = vi.fn<InspectSource>(okInspect)
    const result = await handleStoreRequest(
      { operationId: 'powers.inspect.v1', params: { agent: 'bibit', type: 'skill', name: 'demo' } },
      sources({ inspect }),
      new AbortController().signal
    )
    expect(inspect).toHaveBeenCalledWith({ agent: 'bibit', type: 'skill', name: 'demo' }, expect.any(AbortSignal))
    expect(result).toEqual({ listJson: '[]' })
  })

  it('routes install to the source as an install intent with the version', async () => {
    const mutate = vi.fn<MutateSource>(okMutate)
    const result = await handleStoreRequest(
      {
        operationId: 'powers.install.v1',
        params: { agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0' },
      },
      sources({ mutate }),
      new AbortController().signal
    )
    expect(mutate).toHaveBeenCalledWith(
      { kind: 'install', input: { agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0' } },
      expect.any(AbortSignal)
    )
    expect(result).toEqual({ status: 'exited', exitCode: 0 })
  })

  it('routes uninstall to the source as an uninstall intent without a version', async () => {
    const mutate = vi.fn<MutateSource>(okMutate)
    const result = await handleStoreRequest(
      { operationId: 'powers.uninstall.v1', params: { agent: 'bibit', type: 'skill', name: 'demo' } },
      sources({ mutate }),
      new AbortController().signal
    )
    expect(mutate).toHaveBeenCalledWith(
      { kind: 'uninstall', input: { agent: 'bibit', type: 'skill', name: 'demo' } },
      expect.any(AbortSignal)
    )
    expect(result).toEqual({ status: 'exited', exitCode: 0 })
  })

  it('rejects an install input without a canonical version', async () => {
    await expect(
      handleStoreRequest(
        { operationId: 'powers.install.v1', params: { agent: 'bibit', type: 'skill', name: 'demo', version: 'nope' } },
        sources(),
        new AbortController().signal
      )
    ).rejects.toThrow(/version/)
  })
})

describe('raw envelope + listPowers end-to-end', () => {
  it('paginates 25 series to 20 items and exposes the page-two-only tag facet', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      name: `skill-${index}`,
      version: 'v1.0.0',
      description: '',
      tags: index === 20 ? ['only-on-page-two'] : [],
    }))
    const catalogJson = JSON.stringify({ skills: { items } })
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(catalogJson))
    const snapshot = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    const readMarket: MarketSource = async () => ({ scope: 'market', status: 'data', snapshot, catalogJson })

    const service: FeatureServiceApiV1<'store'> = {
      async request<TResult>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
        return handleStoreRequest(
          { operationId: input.operationId, params: input.params },
          sources({ readMarket }),
          input.signal ?? new AbortController().signal
        ) as TResult
      },
    }

    const input: ListPowersInput = { scope: 'market', type: 'skill', tags: [], page: 1, pageSize: 20 }
    const result = await listPowers(service, input, new AbortController().signal)

    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.items).toHaveLength(20)
      expect(result.facets.tags).toContain('only-on-page-two')
    }
  })

  it('serves not_modified from the shared client cache across two requests', async () => {
    const catalogJson = JSON.stringify({ skills: { items: [{ name: 'demo', version: 'v1.0.0' }] } })
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(catalogJson))
    const snapshot = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    const readMarket = vi.fn<MarketSource>(async (knownSnapshot) =>
      knownSnapshot === snapshot
        ? { scope: 'market', status: 'not_modified', snapshot }
        : { scope: 'market', status: 'data', snapshot, catalogJson }
    )

    const service: FeatureServiceApiV1<'store'> = {
      async request<TResult>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
        return handleStoreRequest(
          { operationId: input.operationId, params: input.params },
          sources({ readMarket }),
          input.signal ?? new AbortController().signal
        ) as TResult
      },
    }

    const input: ListPowersInput = { scope: 'market', type: 'skill', tags: [], page: 1, pageSize: 20 }
    const first = await listPowers(service, input, new AbortController().signal)
    const second = await listPowers(service, input, new AbortController().signal)

    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    expect(readMarket).toHaveBeenNthCalledWith(1, undefined, expect.any(AbortSignal))
    expect(readMarket).toHaveBeenNthCalledWith(2, snapshot, expect.any(AbortSignal))
  })
})
