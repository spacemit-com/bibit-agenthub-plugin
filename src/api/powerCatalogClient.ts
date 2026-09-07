import type { FeatureServiceApiV1 } from '@bibit/feature-sdk'
import {
  POWERS_LIST_OPERATION_ID,
  parseListPowersInput,
  parseListPowersResult,
  parsePowersWireResult,
  type ListPowersInput,
  type ListPowersResult,
  type PowersWireInput,
} from './contracts'
import { verifyCatalogText } from './catalogIntegrity'
import { parseApcCatalog } from './apc'
import {
  buildInstalledPowersResult,
  buildPowersResult,
  parseApmInstalledList,
  type APMPowerRecord,
  type PowerRecord,
} from './apm'

type CacheEntry =
  | { kind: 'market'; snapshot: string; records: PowerRecord[] }
  | { kind: 'installed'; records: APMPowerRecord[] }

interface CacheSlot {
  entry?: CacheEntry
  generation: number
}

type PlatformCode = 'cancelled' | 'incompatible' | 'unavailable'

function platformError(code: PlatformCode, message: string, retryable: boolean): never {
  throw { version: 1, code, message, retryable }
}

function cacheKey(input: ListPowersInput): string {
  return input.scope === 'market' ? 'market' : `installed:${input.agent ?? ''}`
}

function toPowersWireInput(input: ListPowersInput, entry: CacheEntry | undefined): PowersWireInput {
  if (input.scope === 'installed') {
    if (input.agent === undefined) {
      throw new Error('Invalid powers.list.v1 request: installed scope requires an agent')
    }
    return { scope: 'installed', agent: input.agent }
  }
  if (entry?.kind === 'market') {
    return { scope: 'market', knownSnapshot: entry.snapshot }
  }
  return { scope: 'market' }
}

/**
 * The cache is a WeakMap keyed by the current service instance so it dies with the
 * capability handle. Within a service there is one market slot and one slot per
 * agent for installed. Each slot carries a generation that is bumped only on a
 * successful commit; a slower in-flight request detects a newer commit and ends
 * as cancelled instead of overwriting fresher data.
 */
const caches = new WeakMap<FeatureServiceApiV1<'store'>, Map<string, CacheSlot>>()

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

function commitCache(slot: CacheSlot, generation: number, signal: AbortSignal, entry: CacheEntry): void {
  if (signal.aborted || slot.generation !== generation) {
    platformError('cancelled', 'Request was cancelled.', false)
  }
  slot.entry = entry
  slot.generation += 1
}

export async function listPowers(
  service: FeatureServiceApiV1<'store'>,
  input: ListPowersInput,
  signal: AbortSignal
): Promise<ListPowersResult> {
  const query = parseListPowersInput(input)
  const key = cacheKey(query)
  const slot = slotFor(service, key)
  const entry = slot.entry
  const generation = slot.generation

  const wireInput = toPowersWireInput(query, entry)
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
  if (wireResult.scope !== query.scope) {
    platformError('incompatible', 'Provider returned an unexpected scope.', false)
  }

  if (wireResult.scope === 'installed') {
    const records = parseApmInstalledList(JSON.parse(wireResult.listJson))
    commitCache(slot, generation, signal, { kind: 'installed', records })
    return parseListPowersResult(buildInstalledPowersResult(query, records))
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
  commitCache(slot, generation, signal, {
    kind: 'market',
    snapshot: wireResult.snapshot,
    records,
  })
  return parseListPowersResult(buildPowersResult(records, query, wireResult.snapshot))
}
