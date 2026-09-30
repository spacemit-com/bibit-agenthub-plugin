import { describe, expect, it } from 'vitest'
import type { FeatureServiceApiV1, FeatureServiceRequestV1 } from '@bibit/feature-sdk'
import {
  parseSettingsKeyAdd,
  parseSettingsKeyTarget,
  parseSettingsView,
} from './contracts'
import {
  addSettingsKey,
  deleteSettingsKey,
  enableSettingsKey,
  readSettings,
} from './settingsClient'

function makeService(respond: (input: FeatureServiceRequestV1<'store'>) => unknown): {
  service: FeatureServiceApiV1<'store'>
  calls: FeatureServiceRequestV1<'store'>[]
} {
  const calls: FeatureServiceRequestV1<'store'>[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
      calls.push(input)
      return respond(input) as TResult
    },
  }
  return { service, calls }
}

const signal = () => new AbortController().signal
const KEY_ID = '0123456789abcdef0123456789abcdef'

const oneKey = {
  showExperimental: false,
  refreshMinutes: 15,
  keys: [{ id: KEY_ID, preview: 'apc-****-one', enabled: true }],
}

describe('settings client', () => {
  it('reads the key list with an empty closed payload', async () => {
    const { service, calls } = makeService(() => oneKey)
    const view = await readSettings(service, signal())
    expect(view.keys).toHaveLength(1)
    expect(calls[0].operationId).toBe('settings.get.v2')
    expect(calls[0].params).toEqual({})
    expect(calls[0].timeoutMs).toBe(30_000)
  })

  it('sends the credential only to settings.keys.add.v1 and parses the answer', async () => {
    const { service, calls } = makeService(() => oneKey)
    const view = await addSettingsKey(service, 'apc-secret', signal())
    expect(view.keys[0].preview).toBe('apc-****-one')
    expect(calls[0].operationId).toBe('settings.keys.add.v1')
    expect(calls[0].params).toEqual({ apiKey: 'apc-secret' })
    expect(calls[0].timeoutMs).toBe(30_000)
  })

  it('rejects an unusable credential before it reaches the service', async () => {
    const { service, calls } = makeService(() => oneKey)
    await expect(addSettingsKey(service, 'has space', signal())).rejects.toThrow(
      /Invalid settings\.keys\.add\.v1 input/
    )
    expect(calls).toHaveLength(0)
  })

  it('sends only the id for delete and enable', async () => {
    const { service, calls } = makeService(() => oneKey)
    await deleteSettingsKey(service, KEY_ID, signal())
    await enableSettingsKey(service, KEY_ID, signal())
    expect(calls.map((call) => call.operationId)).toEqual([
      'settings.keys.delete.v1',
      'settings.keys.enable.v1',
    ])
    expect(calls.every((call) => JSON.stringify(call.params) === JSON.stringify({ id: KEY_ID }))).toBe(true)
  })

  it('rejects an id that is not a saved-key handle', async () => {
    const { service, calls } = makeService(() => oneKey)
    await expect(deleteSettingsKey(service, 'apc-secret', signal())).rejects.toThrow(
      /Invalid settings\.keys\.delete\.v1 input/
    )
    expect(calls).toHaveLength(0)
  })

  it('maps a provider answer outside the closed shape to a local failure', async () => {
    const { service } = makeService(() => ({ showExperimental: false, refreshMinutes: 15, keys: {}, }))
    await expect(readSettings(service, signal())).rejects.toThrow(/Invalid settings\.get\.v2 result/)
  })
})

describe('parseSettingsView / parseSettingsKeyAdd / parseSettingsKeyTarget', () => {
  it('accepts the masked key list', () => {
    expect(parseSettingsView(oneKey, 'x:')).toEqual(oneKey)
  })

  it('refuses an unmasked preview, a duplicate id and two enabled rows', () => {
    const base = { showExperimental: false, refreshMinutes: 15 }
    for (const keys of [
      // A provider that answered with the real key is a leak, not a row.
      [{ id: KEY_ID, preview: 'apc-secret', enabled: false }],
      [{ id: 'not-a-hex-token', preview: 'apc-****', enabled: false }],
      [
        { id: KEY_ID, preview: 'apc-****-one', enabled: false },
        { id: KEY_ID, preview: 'apc-****-two', enabled: true },
      ],
      [
        { id: KEY_ID, preview: 'apc-****-one', enabled: true },
        { id: 'fedcba9876543210fedcba9876543210', preview: 'apc-****-two', enabled: true },
      ],
      [{ id: KEY_ID, preview: 'apc-****-one', enabled: 'yes' }],
    ]) {
      expect(() => parseSettingsView({ ...base, keys }, 'x:')).toThrow(/^x:/)
    }
    for (const value of [
      { showExperimental: false, refreshMinutes: 15, keys: [], hasApiKey: true },
      { showExperimental: false, refreshMinutes: 4, keys: [] },
      { showExperimental: 'yes', refreshMinutes: 15, keys: [] },
      { showExperimental: false, refreshMinutes: 15 },
    ]) {
      expect(() => parseSettingsView(value, 'x:')).toThrow(/^x:/)
    }
  })

  it('validates the add payload as a printable-ASCII token', () => {
    expect(parseSettingsKeyAdd({ apiKey: 'apc-secret' })).toEqual({ apiKey: 'apc-secret' })
    for (const value of [
      { apiKey: '' },
      { apiKey: 'has space' },
      { apiKey: 'x'.repeat(513) },
      { apiKey: 'ok', extra: true },
      {},
    ]) {
      expect(() => parseSettingsKeyAdd(value)).toThrow(/Invalid settings\.keys\.add\.v1 input/)
    }
  })

  it('validates the delete and enable target as a saved id', () => {
    expect(parseSettingsKeyTarget({ id: KEY_ID }, 'settings.keys.delete.v1')).toEqual({ id: KEY_ID })
    for (const value of [{}, { id: '' }, { id: 'apc-secret' }, { id: KEY_ID, extra: 1 }]) {
      expect(() => parseSettingsKeyTarget(value, 'settings.keys.enable.v1')).toThrow(
        /Invalid settings\.keys\.enable\.v1 input/
      )
    }
  })
})
