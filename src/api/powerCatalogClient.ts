import type { FeatureServiceApiV1 } from '@bibit/feature-sdk'
import {
  POWERS_LIST_OPERATION_ID,
  parseListPowersInput,
  parseListPowersResult,
  parsePowersWireResult,
  type CustomResourceList,
  type CustomResourceSkipped,
  type ListPowersInput,
  type ListPowersResult,
  type PowerWarning,
} from './contracts'
import { verifyCatalogText } from './catalogIntegrity'
import { parseApcCatalog } from './apc'
import {
  buildMergedInstalledPowersResult,
  buildPowersResult,
  powerSeriesKey,
  type PowerRecord,
} from './apm'
import { listCustomResources } from './customResources'
import { getInstallationStore } from './installationStore'

type CacheEntry = { kind: 'market'; snapshot: string; records: PowerRecord[] }

interface CacheSlot {
  entry?: CacheEntry
  generation: number
}

type PlatformCode = 'cancelled' | 'incompatible'

function platformError(code: PlatformCode, message: string, retryable: boolean): never {
  throw { version: 1, code, message, retryable }
}

/**
 * The market cache is a WeakMap keyed by the current service instance so it dies
 * with the capability handle. Each slot carries a generation that is bumped only
 * on a successful commit; a slower in-flight request detects a newer commit and
 * answers from that newer cache instead of overwriting it. Installed data is not
 * cached here: it is delegated to the shared installation store.
 */
const caches = new WeakMap<FeatureServiceApiV1<'store'>, Map<string, CacheSlot>>()

type CustomLoad = { items: CustomResourceList['items']; skipped: CustomResourceSkipped[]; warnings: PowerWarning[] }

/**
 * Reads the custom scan and never rejects: the caller needs the Hub list either
 * way, so a scan failure is reported as one warning on an empty custom list. An
 * abort is the exception — it means the page is gone, so it propagates.
 */
async function loadCustomResources(
  service: FeatureServiceApiV1<'store'>,
  agent: string,
  signal: AbortSignal
): Promise<CustomLoad> {
  try {
    const list = await listCustomResources(service, agent, signal)
    return { items: list.items, skipped: list.skipped, warnings: [] }
  } catch (reason: unknown) {
    if (signal.aborted) {
      platformError('cancelled', 'Request was cancelled.', false)
    }
    const code = (reason as { code?: unknown } | null)?.code
    if (code === 'cancelled') {
      platformError('cancelled', 'Request was cancelled.', false)
    }
    return {
      items: [],
      skipped: [],
      warnings: [
        {
          code: 'custom-resources-unavailable',
          agent,
          message: 'Custom resources could not be scanned for this Agent.',
        },
      ],
    }
  }
}

/**
 * Turns the scanner's skip list into warnings the page can render. A directory
 * whose `(type,name)` the APM manifest already manages is dropped: that Power's
 * card is fed by the manifest, so the local directory is not a "skipped custom
 * resource" the user needs to hear about. Warning about it would be pure noise —
 * a Hub-managed Power is routinely installed into the very directory the scanner
 * walks, and the scanner's job is only to find what the manifest does not have.
 */
function customSkippedWarnings(
  agent: string,
  skipped: readonly CustomResourceSkipped[],
  managed: ReadonlySet<string>
): PowerWarning[] {
  return skipped
    .filter((entry) => !managed.has(powerSeriesKey(entry.type, entry.name)))
    .map((entry) => ({
      code: 'custom-resource-skipped',
      agent,
      message:
        entry.reason === 'missing-authority-file'
          ? 'Skipped {type} "{name}": {expected} is missing.'
          : 'Skipped {type} "{name}": its {expected} does not meet the minimum format.',
      values: {
        type: entry.type,
        name: entry.name,
        expected: entry.expected,
      },
    }))
}

function slotFor(service: FeatureServiceApiV1<'store'>, key: string): CacheSlot {
  let slots = caches.get(service)
  if (!slots) {
    slots = new Map()
    caches.set(service, slots)
  }
  let slot = slots.get(key)
  if (!slot) {
    slot = { generation: 0 }
    slots.set(key, slot)
  }
  return slot
}

/**
 * Commits a freshly downloaded catalog, or yields to a newer commit. A slow
 * request that started before another one committed must not overwrite the
 * fresher data, but being superseded is not a failure the user caused: it
 * reports 'superseded' so the caller answers from the newer cache instead of
 * surfacing a cancellation. An aborted request still refuses to commit.
 */
function commitCache(
  slot: CacheSlot,
  generation: number,
  signal: AbortSignal,
  entry: CacheEntry
): 'committed' | 'superseded' {
  if (signal.aborted) {
    platformError('cancelled', 'Request was cancelled.', false)
  }
  if (slot.generation !== generation) {
    return 'superseded'
  }
  slot.entry = entry
  slot.generation += 1
  return 'committed'
}

export async function listPowers(
  service: FeatureServiceApiV1<'store'>,
  input: ListPowersInput,
  signal: AbortSignal
): Promise<ListPowersResult> {
  const query = parseListPowersInput(input)

  if (query.scope === 'installed') {
    if (query.agent === undefined) {
      throw new Error('Invalid powers.list.v1 request: installed scope requires an agent')
    }
    const agent = query.agent
    // The installed view is the APM manifest plus the resources a user dropped
    // into the Agent's own tree. The custom scan is best-effort: a failure must
    // degrade to "no custom resources, one warning" instead of turning the whole
    // installed page into an error, which also keeps the page usable against a
    // provider CLI that predates the custom operations.
    const [records, custom] = await Promise.all([
      getInstallationStore(service).refreshAgent(agent, signal),
      loadCustomResources(service, agent, signal),
    ])
    // The manifest is the authority for the Powers it manages; the scanner only
    // contributes what is left. Both the entries and the skipped directories are
    // split against that same set, so a managed Power never produces a warning.
    const managed = new Set(records.map((record) => powerSeriesKey(record.type, record.name)))
    const result = buildMergedInstalledPowersResult(query, records, custom.items)
    const warnings = [...custom.warnings, ...customSkippedWarnings(agent, custom.skipped, managed)]
    if (result.status === 'ready' && warnings.length > 0) {
      return parseListPowersResult({
        ...result,
        warnings: [...result.warnings, ...warnings],
      })
    }
    return parseListPowersResult(result)
  }

  const slot = slotFor(service, 'market')
  const entry = slot.entry
  const generation = slot.generation

  const wireInput =
    entry?.kind === 'market' ? { scope: 'market', knownSnapshot: entry.snapshot } : { scope: 'market' }
  const wireResult = parsePowersWireResult(
    await service.request<Record<string, unknown>>({
      serviceId: 'store',
      operationId: POWERS_LIST_OPERATION_ID,
      params: wireInput as unknown as Record<string, unknown>,
      timeoutMs: 30_000,
      signal,
    })
  )

  if (signal.aborted) {
    platformError('cancelled', 'Request was cancelled.', false)
  }
  if (wireResult.scope !== 'market') {
    platformError('incompatible', 'Provider returned an unexpected scope.', false)
  }

  if (wireResult.status === 'not_modified') {
    if (entry?.kind !== 'market' || entry.snapshot !== wireResult.snapshot) {
      platformError('incompatible', 'Provider returned not_modified without a matching cache.', false)
    }
    return parseListPowersResult(buildPowersResult(entry.records, query, wireResult.snapshot))
  }

  await verifyCatalogText(wireResult.catalogJson, wireResult.snapshot)
  if (signal.aborted) {
    platformError('cancelled', 'Request was cancelled.', false)
  }
  const records = parseApcCatalog(JSON.parse(wireResult.catalogJson))
  const committed = commitCache(slot, generation, signal, {
    kind: 'market',
    snapshot: wireResult.snapshot,
    records,
  })
  if (committed === 'superseded') {
    // A newer request committed while this one was in flight: answer from that
    // fresher catalog instead of reporting the supersede as a cancellation.
    const newer = slot.entry
    if (newer?.kind === 'market') {
      return parseListPowersResult(buildPowersResult(newer.records, query, newer.snapshot))
    }
  }
  return parseListPowersResult(buildPowersResult(records, query, wireResult.snapshot))
}
