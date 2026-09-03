import {
  parseListPowersInput,
  type ListPowersInput,
  type ListPowersResult,
} from '../src/api/contracts'
import {
  buildInstalledPowersResult,
  buildPowersResult,
  type APMPowerRecord,
  type PowerRecord,
} from '../src/api/apm'

/**
 * Pure dev Store core for the Feature Dev Host. It contains no Node APIs: the apm
 * CLI spawn and the APC catalog fetch live in vite.config.ts (dev-only, not
 * type-checked), never in the plugin bundle. Installed scope is backed by apm via
 * the injected runApm; market scope is backed by the live APC public catalog via
 * the injected runApcCatalog (no fixtures, no cache); settings are an in-memory echo.
 */

type SettingsState = { showExperimental: boolean; refreshMinutes: number }

let settings: SettingsState = { showExperimental: false, refreshMinutes: 15 }

export type ApmListResult =
  | { status: 'ok'; records: APMPowerRecord[] }
  | { status: 'not-installed' }
  | { status: 'unavailable' }

export type ApmRunner = (agent: string) => Promise<ApmListResult>

export type ApcCatalogResult =
  | { status: 'ok'; snapshot: string; records: PowerRecord[] }
  | { status: 'unavailable' }

export type ApcCatalogRunner = () => Promise<ApcCatalogResult>

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
  runApm: ApmRunner,
  runApcCatalog: ApcCatalogRunner
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

  const query = parseListPowersInput(params)
  if (query.scope === 'market') {
    const catalog = await runApcCatalog()
    if (catalog.status === 'unavailable') {
      // This exact message is matched by src/AgentHubPage.tsx to render a retryable
      // unavailable state (the Dev Host drops the structured error code).
      throw new StoreError('unavailable', true, 'APC catalog is unavailable')
    }
    return buildPowersResult(catalog.records, query, catalog.snapshot)
  }

  const agent = query.agent
  if (agent === undefined) {
    throw new StoreError('incompatible', false, 'installed scope requires an agent')
  }

  const result = await runApm(agent)
  if (result.status === 'unavailable') {
    // This exact message is matched by src/AgentHubPage.tsx to render a retryable
    // unavailable state (the Dev Host drops the structured error code).
    throw new StoreError('unavailable', true, 'apm CLI is unavailable')
  }
  // A non-installed agent and an installed-but-empty agent both render as empty.
  if (result.status === 'not-installed') {
    return buildInstalledPowersResult(query, [])
  }
  return buildInstalledPowersResult(query, result.records)
}
