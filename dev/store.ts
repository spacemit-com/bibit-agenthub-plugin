import {
  parsePowersWireInput,
  parsePowersWireResult,
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
 * an in-memory echo, unchanged from the previous behavior.
 */

type SettingsState = { showExperimental: boolean; refreshMinutes: number }

let settings: SettingsState = { showExperimental: false, refreshMinutes: 15 }

export type InstalledSource = (agent: string, signal: AbortSignal) => Promise<PowersWireResult>
export type MarketSource = (
  knownSnapshot: string | undefined,
  signal: AbortSignal
) => Promise<PowersWireResult>
export type InspectSource = (target: PowerTarget, signal: AbortSignal) => Promise<InspectResult>
export type MutateSource = (intent: MutationIntent, signal: AbortSignal) => Promise<MutationResult>

export interface StoreSources {
  readInstalled: InstalledSource
  readMarket: MarketSource
  inspect: InspectSource
  mutate: MutateSource
}

export class StoreError extends Error {
  constructor(
    readonly code: 'unavailable' | 'incompatible',
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

  if (operationId === 'settings.get.v1') return settings
  if (operationId === 'settings.update.v1') {
    settings = params as SettingsState
    return settings
  }
  if (operationId === 'powers.list.v1') {
    const wire = parsePowersWireInput(params)
    const result =
      wire.scope === 'market'
        ? await sources.readMarket(wire.knownSnapshot, signal)
        : await sources.readInstalled(wire.agent, signal)
    return parsePowersWireResult(result)
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
