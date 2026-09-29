import {
  parseCustomListInput,
  parseCustomListResult,
  parseDeleteResult,
  parseDeleteTarget,
  parsePowersWireInput,
  parsePowersWireResult,
  parseSettingsUpdate,
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

/**
 * Pure dev Store core for the Feature Dev Host. It contains no Node APIs and no
 * business aggregation: it validates the raw wire envelope, delegates the transport
 * to the injected sources, and passes the raw result back for the browser-side
 * clients (listPowers / installation store) to parse and aggregate. Settings are
 * an in-memory echo that also carries the APC credential as a write-only field,
 * mirroring the production provider's `hasApiKey` contract.
 */

type SettingsState = {
  showExperimental: boolean
  refreshMinutes: number
  apiKey: string
}

let settings: SettingsState = { showExperimental: false, refreshMinutes: 15, apiKey: '' }

function settingsView(): { showExperimental: boolean; refreshMinutes: number; hasApiKey: boolean } {
  return {
    showExperimental: settings.showExperimental,
    refreshMinutes: settings.refreshMinutes,
    hasApiKey: settings.apiKey !== '',
  }
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

export interface StoreSources {
  readInstalled: InstalledSource
  readMarket: MarketSource
  inspect: InspectSource
  mutate: MutateSource
  readCustom: CustomListSource
  upload: CustomUploadSource
  removeCustom: CustomDeleteSource
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

  if (operationId === 'settings.get.v1') return settingsView()
  if (operationId === 'settings.update.v1') {
    // The dev echo validates the same payload the provider does (closed keys,
    // refresh range, printable-ASCII key length), so a page that sends an
    // unusable key fails in Local Preview rather than only on a board.
    const update = parseSettingsUpdate(params)
    settings = {
      showExperimental: update.showExperimental,
      refreshMinutes: update.refreshMinutes,
      apiKey: update.apiKey === undefined ? settings.apiKey : update.apiKey,
    }
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
        settings.apiKey,
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
  throw new StoreError('incompatible', false, 'Unknown operation: ' + operationId)
}
