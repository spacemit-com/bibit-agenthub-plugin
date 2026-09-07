import {
  parsePowersWireInput,
  parsePowersWireResult,
  type PowersWireResult,
} from '../src/api/contracts'

/**
 * Pure dev Store core for the Feature Dev Host. It contains no Node APIs and no
 * business aggregation: it validates the raw wire envelope, delegates the transport
 * to the injected sources, and passes the raw `PowersWireResult` back for the
 * browser-side `listPowers` client to parse and aggregate. Settings are an
 * in-memory echo, unchanged from the previous behavior.
 */

type SettingsState = { showExperimental: boolean; refreshMinutes: number }

let settings: SettingsState = { showExperimental: false, refreshMinutes: 15 }

export type InstalledSource = (agent: string, signal: AbortSignal) => Promise<PowersWireResult>
export type MarketSource = (
  knownSnapshot: string | undefined,
  signal: AbortSignal
) => Promise<PowersWireResult>

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
  readInstalled: InstalledSource,
  readMarket: MarketSource,
  signal: AbortSignal
): Promise<unknown> {
  const { operationId, params } = input

  if (operationId === 'settings.get.v1') return settings
  if (operationId === 'settings.update.v1') {
    settings = params as SettingsState
    return settings
  }
  if (operationId !== 'powers.list.v1') {
    throw new StoreError('incompatible', false, 'Unknown operation: ' + operationId)
  }

  const wire = parsePowersWireInput(params)
  const result =
    wire.scope === 'market'
      ? await readMarket(wire.knownSnapshot, signal)
      : await readInstalled(wire.agent, signal)
  return parsePowersWireResult(result)
}
