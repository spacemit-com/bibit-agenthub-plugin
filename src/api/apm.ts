import {
  POWER_PAGE_SIZE,
  POWER_TYPES,
  type ListPowersInput,
  type ListPowersResult,
  type PowerSeries,
  type PowerType,
} from './contracts'

/**
 * A single record from `apm list --installed --agent=<agent> --json --all`.
 * `description` and `tags` are omitted by apm when empty, so they stay optional
 * here and are normalized to `''` / `[]` during parsing.
 */
export interface APMPowerRecord {
  agent: string
  type: PowerType
  name: string
  version: string
  description?: string
  tags?: string[]
}

/**
 * A normalized, de-duplicated Power record ready for series aggregation.
 * The `agent` dimension is resolved before aggregation (per-agent CLI call).
 */
export interface PowerRecord {
  type: PowerType
  name: string
  version: string
  description: string
  tags: string[]
}

const VERSION_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

const POWER_TYPE_SET: ReadonlySet<string> = new Set(POWER_TYPES)

function fail(reason: string): never {
  throw new Error(`Invalid apm list output: ${reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseApmPowerRecord(value: unknown): APMPowerRecord {
  if (!isRecord(value)) {
    fail('each power must be an object')
  }
  const { agent, type, name, version, description, tags } = value

  if (typeof agent !== 'string' || agent.length === 0) {
    fail('agent must be a non-empty string')
  }
  if (typeof type !== 'string' || !POWER_TYPE_SET.has(type)) {
    fail('type must be one of skill, plugin, mcp, agent')
  }
  if (typeof name !== 'string' || name.length === 0) {
    fail('name must be a non-empty string')
  }
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    fail('version must be a canonical vMAJOR.MINOR.PATCH string')
  }
  if (description !== undefined && typeof description !== 'string') {
    fail('description must be a string')
  }
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))) {
    fail('tags must be an array of strings')
  }

  return {
    agent,
    type: type as PowerType,
    name,
    version,
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags: [...tags] } : {}),
  }
}

/**
 * Parses and validates the JSON array returned by
 * `apm list --installed --agent=<agent> --json --all`.
 * Unknown fields are tolerated (apm owns its output schema); required fields are
 * type-checked, and missing `description`/`tags` normalize to `''`/`[]`.
 */
export function parseApmInstalledList(value: unknown): APMPowerRecord[] {
  if (!Array.isArray(value)) {
    fail('output must be a JSON array')
  }
  return value.map(parseApmPowerRecord)
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function parseVersionParts(version: string): [number, number, number] {
  const match = VERSION_PATTERN.exec(version)
  if (!match) throw new Error(`Invalid version: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersionsDescending(left: string, right: string): number {
  const [lMajor, lMinor, lPatch] = parseVersionParts(left)
  const [rMajor, rMinor, rPatch] = parseVersionParts(right)
  if (rMajor !== lMajor) return rMajor - lMajor
  if (rMinor !== lMinor) return rMinor - lMinor
  return rPatch - lPatch
}

function compareSeries(left: PowerSeries, right: PowerSeries): number {
  if (left.type !== right.type) return left.type < right.type ? -1 : 1
  if (left.name !== right.name) return left.name < right.name ? -1 : 1
  return 0
}

type PowersResultQuery = Pick<ListPowersInput, 'type' | 'tags' | 'page' | 'snapshot'>

/**
 * Shared series aggregation + closed-DTO result assembly for a set of normalized
 * records. Filters by type, then by tag OR on exact versions, groups into series,
 * sorts versions SemVer-descending, paginates 20 series per page, and derives
 * `facets.tags` from the selected type's full record set (ignoring tag selection).
 * `facets.agents` is always `[]` because agent discovery is not performed.
 */
export function buildPowersResult(
  records: readonly PowerRecord[],
  query: PowersResultQuery,
  snapshot: string
): ListPowersResult {
  const tagsFacet = sortedUnique(
    records.filter((record) => record.type === query.type).flatMap((record) => record.tags)
  )

  const filtered = records.filter((record) => {
    if (record.type !== query.type) return false
    if (query.tags.length === 0) return true
    return record.tags.some((tag) => query.tags.includes(tag))
  })

  const groups = new Map<string, PowerRecord[]>()
  for (const record of filtered) {
    const key = `${record.type}\u0000${record.name}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(record)
    else groups.set(key, [record])
  }

  const series: PowerSeries[] = [...groups.values()].map((group) => ({
    type: group[0].type,
    name: group[0].name,
    versions: group
      .map((record) => ({
        version: record.version,
        description: record.description,
        tags: [...record.tags],
      }))
      .sort((left, right) => compareVersionsDescending(left.version, right.version)),
  }))
  series.sort(compareSeries)

  const total = series.length

  if (query.page > 1 && query.snapshot !== snapshot) {
    return { status: 'reset_required', reason: 'snapshot_changed' }
  }

  const start = (query.page - 1) * POWER_PAGE_SIZE
  const items = series.slice(start, start + POWER_PAGE_SIZE)
  const nextPage = start + POWER_PAGE_SIZE < total ? query.page + 1 : undefined

  return {
    status: 'ready',
    snapshot,
    items,
    page: query.page,
    pageSize: POWER_PAGE_SIZE,
    total,
    facets: { agents: [], tags: tagsFacet },
    warnings: [],
    ...(nextPage !== undefined ? { nextPage } : {}),
  }
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function snapshotForRecords(records: readonly PowerRecord[]): string {
  const canonical = records
    .map(
      (record) =>
        `${record.type}\u0000${record.name}\u0000${record.version}\u0000${record.description}\u0000${record.tags.join('\u0001')}`
    )
    .sort()
    .join('\n')
  return `apm-installed-${fnv1a32(canonical)}`
}

/**
 * Builds the installed-scope `powers.list.v1` result from a single agent's apm
 * records. Records not belonging to `query.agent` are ignored defensively, exact
 * `(type,name,version)` duplicates are removed, and the snapshot is a content hash
 * of the fetched set so page 2 of changed data yields `reset_required`.
 */
export function buildInstalledPowersResult(
  query: ListPowersInput,
  records: readonly APMPowerRecord[]
): ListPowersResult {
  const agent = query.agent
  if (agent === undefined) {
    throw new Error('installed scope requires an agent')
  }

  const seen = new Set<string>()
  const normalized: PowerRecord[] = []
  for (const record of records) {
    if (record.agent !== agent) continue
    const key = `${record.type}\u0000${record.name}\u0000${record.version}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({
      type: record.type,
      name: record.name,
      version: record.version,
      description: record.description ?? '',
      tags: sortedUnique(record.tags ?? []),
    })
  }

  return buildPowersResult(normalized, query, snapshotForRecords(normalized))
}
