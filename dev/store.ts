import {
  parseCustomListInput,
  parseCustomListResult,
  parseDeleteResult,
  parseDeleteTarget,
  parsePowersWireInput,
  parsePowersWireResult,
  parseSettingsKeyAdd,
  parseSettingsKeyTarget,
  parseUploadInput,
  parseUploadResult,
  type PowersWireResult,
} from '../src/api/contracts'
import {
  parseInstallInput,
  parsePowerTarget,
  type InspectResult,
  type MutationIntent,
  type MutationResult,
  type PowerTarget,
} from '../src/api/powerOperations'
import { parseUpgradeScope } from '../src/api/upgrade'

/**
 * Pure dev Store core for the Feature Dev Host. It contains no Node APIs and no
 * business aggregation: it validates the raw wire envelope, delegates the transport
 * to the injected sources, and passes the raw result back for the browser-side
 * clients (listPowers / installation store) to parse and aggregate. Settings are
 * an in-memory echo of the provider's key list: the same masking, the same
 * "first key enabled / at most one enabled" rules, and the enabled key is what
 * the upload source receives.
 */

type StoredAPIKey = { id: string; key: string; enabled: boolean }

type SettingsState = {
  showExperimental: boolean
  refreshMinutes: number
  keys: StoredAPIKey[]
}

let settings: SettingsState = { showExperimental: false, refreshMinutes: 15, keys: [] }
let nextKeyId = 0

/** A 128-bit-looking handle, so the dev ids pass the same closed validation. */
function newKeyId(): string {
  nextKeyId += 1
  return nextKeyId.toString(16).padStart(32, '0')
}

/**
 * Mirrors the provider's MaskAPIKey exactly: a head, a fixed `****` run and a
 * tail, so the mask is never mistakable for a real key.
 */
export function maskAPIKey(key: string): string {
  if (key === '') return ''
  if (key.length <= 8) return key.slice(0, Math.min(2, key.length)) + '****'
  return key.slice(0, 4) + '****' + key.slice(key.length - 4)
}

function settingsView(): {
  showExperimental: boolean
  refreshMinutes: number
  keys: { id: string; preview: string; enabled: boolean }[]
} {
  return {
    showExperimental: settings.showExperimental,
    refreshMinutes: settings.refreshMinutes,
    keys: settings.keys.map((entry) => ({
      id: entry.id,
      preview: maskAPIKey(entry.key),
      enabled: entry.enabled,
    })),
  }
}

function enabledAPIKey(): string {
  return settings.keys.find((entry) => entry.enabled)?.key ?? ''
}

/** Resets the in-memory settings; tests use it to keep cases independent. */
export function resetDevSettings(): void {
  settings = { showExperimental: false, refreshMinutes: 15, keys: [] }
  nextKeyId = 0
}


export type InstalledSource = (agent: string, signal: AbortSignal) => Promise<PowersWireResult>
export type MarketSource = (
  knownSnapshot: string | undefined,
  signal: AbortSignal
) => Promise<PowersWireResult>
export type InspectSource = (target: PowerTarget, signal: AbortSignal) => Promise<InspectResult>
export type MutateSource = (intent: MutationIntent, signal: AbortSignal) => Promise<MutationResult>
export type CustomListSource = (agent: string, signal: AbortSignal) => Promise<CustomListResultShape>
export type CustomUploadSource = (
  target: PowerTarget,
  message: string,
  apiKey: string,
  signal: AbortSignal
) => Promise<UploadResultShape>
export type CustomDeleteSource = (target: PowerTarget) => Promise<{ status: 'deleted' }>

export interface CustomListResultShape {
  scope: 'custom'
  status: 'data'
  itemsJson: string
}

export interface UploadResultShape {
  status: 'exited'
  exitCode: number
  stage: 'validate' | 'submit'
  reason?: string
  stdout?: string
}

export interface UpgradeResultShape {
  status: 'exited'
  exitCode: number
  items: unknown[]
  reason?: string
}

export type UpgradeSource = (agent: string, signal: AbortSignal) => Promise<UpgradeResultShape>

export interface StoreSources {
  readInstalled: InstalledSource
  readMarket: MarketSource
  inspect: InspectSource
  mutate: MutateSource
  readCustom: CustomListSource
  upload: CustomUploadSource
  removeCustom: CustomDeleteSource
  upgrade: UpgradeSource
}

export class StoreError extends Error {
  constructor(
    readonly code: 'unavailable' | 'incompatible' | 'unauthorized',
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
  }
}

export async function handleStoreRequest(
  input: { operationId: string; params: unknown },
  sources: StoreSources,
  signal: AbortSignal
): Promise<unknown> {
  const { operationId, params } = input

  if (operationId === 'settings.get.v2') return settingsView()
  if (operationId === 'settings.keys.add.v1') {
    // The dev echo validates the same payload the provider does (closed keys,
    // printable-ASCII token, length cap), so a page that sends an unusable key
    // fails in Local Preview rather than only on a board.
    const { apiKey } = parseSettingsKeyAdd(params)
    if (settings.keys.some((entry) => entry.key === apiKey)) {
      throw new StoreError('incompatible', false, 'The key is already saved')
    }
    settings = {
      ...settings,
      // The first saved key is enabled; every later one stays disabled so adding
      // a key never switches the credential an upload is using.
      keys: [...settings.keys, { id: newKeyId(), key: apiKey, enabled: settings.keys.length === 0 }],
    }
    return settingsView()
  }
  if (operationId === 'settings.keys.delete.v1') {
    const { id } = parseSettingsKeyTarget(params, operationId)
    if (!settings.keys.some((entry) => entry.id === id)) {
      throw new StoreError('incompatible', false, 'Unknown apiKey id')
    }
    // Deleting the enabled key leaves the rest disabled: the user picks next.
    settings = { ...settings, keys: settings.keys.filter((entry) => entry.id !== id) }
    return settingsView()
  }
  if (operationId === 'settings.keys.enable.v1') {
    const { id } = parseSettingsKeyTarget(params, operationId)
    if (!settings.keys.some((entry) => entry.id === id)) {
      throw new StoreError('incompatible', false, 'Unknown apiKey id')
    }
    settings = { ...settings, keys: settings.keys.map((entry) => ({ ...entry, enabled: entry.id === id })) }
    return settingsView()
  }
  if (operationId === 'powers.list.v1') {
    const wire = parsePowersWireInput(params)
    const result =
      wire.scope === 'market'
        ? await sources.readMarket(wire.knownSnapshot, signal)
        : await sources.readInstalled(wire.agent, signal)
    return parsePowersWireResult(result)
  }
  if (operationId === 'powers.custom.list.v1') {
    const custom = parseCustomListInput(params)
    return parseCustomListResult(await sources.readCustom(custom.agent, signal))
  }
  if (operationId === 'powers.upload.v1') {
    const upload = parseUploadInput(params)
    return parseUploadResult(
      await sources.upload(
        { agent: upload.agent, type: upload.type, name: upload.name },
        upload.message,
        enabledAPIKey(),
        signal
      )
    )
  }
  if (operationId === 'powers.delete.v1') {
    return parseDeleteResult(await sources.removeCustom(parseDeleteTarget(params)))
  }
  if (operationId === 'powers.inspect.v1') {
    return sources.inspect(parsePowerTarget(params), signal)
  }
  if (operationId === 'powers.install.v1') {
    return sources.mutate({ kind: 'install', input: parseInstallInput(params) }, signal)
  }
  if (operationId === 'powers.uninstall.v1') {
    return sources.mutate({ kind: 'uninstall', input: parsePowerTarget(params) }, signal)
  }
  if (operationId === 'powers.upgrade.v1') {
    return sources.upgrade(parseUpgradeScope(params), signal)
  }
  throw new StoreError('incompatible', false, 'Unknown operation: ' + operationId)
}
