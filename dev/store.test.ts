import { describe, expect, it, vi } from 'vitest'
import type { FeatureServiceApiV1, FeatureServiceRequestV1 } from '@bibit/feature-sdk'
import type { ListPowersInput } from '../src/api/contracts'
import { listPowers } from '../src/api/powerCatalogClient'
import {
  handleStoreRequest,
  resetDevSettings,
  StoreError,
  type CustomDeleteSource,
  type CustomListSource,
  type CustomUploadSource,
  type InspectSource,
  type InstalledSource,
  type MarketSource,
  type MutateSource,
  type StoreSources,
  type UpgradeSource,
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
const okCustomList: CustomListSource = async () => ({
  scope: 'custom',
  status: 'data',
  itemsJson: '{"items":[],"skipped":[]}',
})
const okCustomUpload: CustomUploadSource = async () => ({ status: 'exited', exitCode: 0, stage: 'submit' })
const okCustomDelete: CustomDeleteSource = async () => ({ status: 'deleted' })
const okUpgrade: UpgradeSource = async () => ({ status: 'exited', exitCode: 0, items: [] })

function sources(overrides: Partial<StoreSources> = {}): StoreSources {
  return {
    readInstalled: okInstalled,
    readMarket: okMarket,
    inspect: okInspect,
    mutate: okMutate,
    readCustom: okCustomList,
    upload: okCustomUpload,
    removeCustom: okCustomDelete,
    upgrade: okUpgrade,
    ...overrides,
  }
}

function marketQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...marketWire, ...overrides }
}

describe('handleStoreRequest', () => {
  it('returns an empty key list for settings.get.v2', async () => {
    resetDevSettings()
    await expect(
      handleStoreRequest({ operationId: 'settings.get.v2', params: {} }, sources(), new AbortController().signal)
    ).resolves.toEqual({ showExperimental: false, refreshMinutes: 15, keys: [] })
  })

  it('adds masked keys, enables the first only, and moves the enabled flag explicitly', async () => {
    resetDevSettings()
    const added = (await handleStoreRequest(
      { operationId: 'settings.keys.add.v1', params: { apiKey: 'apc-key-one' } },
      sources(),
      new AbortController().signal
    )) as { keys: { id: string; preview: string; enabled: boolean }[] }
    // The first saved key is enabled and is only ever reported masked.
    expect(added.keys).toHaveLength(1)
    expect(added.keys[0].enabled).toBe(true)
    expect(added.keys[0].preview).toBe('apc-****-one')
    expect(JSON.stringify(added)).not.toContain('apc-key-one')

    const second = (await handleStoreRequest(
      { operationId: 'settings.keys.add.v1', params: { apiKey: 'apc-key-two' } },
      sources(),
      new AbortController().signal
    )) as { keys: { id: string; preview: string; enabled: boolean }[] }
    expect(second.keys[0].enabled).toBe(true)
    expect(second.keys[1].enabled).toBe(false)

    // The enabled key is the credential the upload source receives.
    const upload = vi.fn<CustomUploadSource>(okCustomUpload)
    await handleStoreRequest(
      {
        operationId: 'powers.upload.v1',
        params: { agent: 'bibit', type: 'skill', name: 'demo', message: 'publish it' },
      },
      sources({ upload }),
      new AbortController().signal
    )
    expect(upload).toHaveBeenCalledWith(
      { agent: 'bibit', type: 'skill', name: 'demo' },
      'publish it',
      'apc-key-one',
      expect.anything()
    )

    // Enabling the second one switches the flag and nothing else.
    const enabled = (await handleStoreRequest(
      { operationId: 'settings.keys.enable.v1', params: { id: second.keys[1].id } },
      sources(),
      new AbortController().signal
    )) as { keys: { enabled: boolean }[] }
    expect(enabled.keys.map((key) => key.enabled)).toEqual([false, true])

    // Deleting the enabled key leaves the survivor disabled.
    const deleted = (await handleStoreRequest(
      { operationId: 'settings.keys.delete.v1', params: { id: second.keys[1].id } },
      sources(),
      new AbortController().signal
    )) as { keys: { enabled: boolean }[] }
    expect(deleted.keys).toHaveLength(1)
    expect(deleted.keys[0].enabled).toBe(false)
  })

  it('rejects an unusable key, a duplicate key and an unknown id', async () => {
    resetDevSettings()
    const signal = new AbortController().signal
    // The closed parser rejects a non-ASCII or empty token before the store runs.
    await expect(
      handleStoreRequest({ operationId: 'settings.keys.add.v1', params: { apiKey: 'has space' } }, sources(), signal)
    ).rejects.toThrow(/Invalid settings\.keys\.add\.v1 input/)
    await expect(
      handleStoreRequest({ operationId: 'settings.keys.add.v1', params: { apiKey: '' } }, sources(), signal)
    ).rejects.toThrow(/Invalid settings\.keys\.add\.v1 input/)
    await handleStoreRequest({ operationId: 'settings.keys.add.v1', params: { apiKey: 'k' } }, sources(), signal)
    await expect(
      handleStoreRequest({ operationId: 'settings.keys.add.v1', params: { apiKey: 'k' } }, sources(), signal)
    ).rejects.toBeInstanceOf(StoreError)
    await expect(
      handleStoreRequest(
        { operationId: 'settings.keys.delete.v1', params: { id: 'ffffffffffffffffffffffffffffffff' } },
        sources(),
        signal
      )
    ).rejects.toBeInstanceOf(StoreError)
    await expect(
      handleStoreRequest(
        { operationId: 'settings.keys.enable.v1', params: { id: 'not-an-id' } },
        sources(),
        signal
      )
    ).rejects.toThrow(/Invalid settings\.keys\.enable\.v1 input/)
  })

  it('routes the custom scan and the two custom writes to their sources', async () => {
    const readCustom = vi.fn<CustomListSource>(okCustomList)
    const upload = vi.fn<CustomUploadSource>(okCustomUpload)
    const removeCustom = vi.fn<CustomDeleteSource>(okCustomDelete)
    const store = sources({ readCustom, upload, removeCustom })
    const signal = new AbortController().signal

    await expect(
      handleStoreRequest({ operationId: 'powers.custom.list.v1', params: { agent: 'codex' } }, store, signal)
    ).resolves.toEqual({ scope: 'custom', status: 'data', itemsJson: '{"items":[],"skipped":[]}' })
    expect(readCustom).toHaveBeenCalledWith('codex', signal)

    await expect(
      handleStoreRequest(
        {
          operationId: 'powers.upload.v1',
          params: { agent: 'bibit', type: 'skill', name: 'demo', message: 'publish it' },
        },
        store,
        signal
      )
    ).resolves.toEqual({ status: 'exited', exitCode: 0, stage: 'submit' })
    expect(upload).toHaveBeenCalledWith(
      { agent: 'bibit', type: 'skill', name: 'demo' },
      'publish it',
      expect.any(String),
      signal
    )

    await expect(
      handleStoreRequest(
        { operationId: 'powers.delete.v1', params: { agent: 'bibit', type: 'skill', name: 'demo' } },
        store,
        signal
      )
    ).resolves.toEqual({ status: 'deleted' })
    expect(removeCustom).toHaveBeenCalledWith({ agent: 'bibit', type: 'skill', name: 'demo' })
  })

  it('rejects a custom request outside the closed shape', async () => {
    const store = sources()
    const signal = new AbortController().signal
    await expect(
      handleStoreRequest({ operationId: 'powers.custom.list.v1', params: { agent: 'all' } }, store, signal)
    ).rejects.toThrow(/powers\.custom\.list\.v1/)
    await expect(
      handleStoreRequest(
        { operationId: 'powers.upload.v1', params: { agent: 'bibit', type: 'skill', name: 'demo', message: '   ' } },
        store,
        signal
      )
    ).rejects.toThrow(/message/)
    await expect(
      handleStoreRequest(
        { operationId: 'powers.delete.v1', params: { agent: 'bibit', type: 'skill', name: '../escape' } },
        store,
        signal
      )
    ).rejects.toThrow(/powers\.delete\.v1/)
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
