import {
  POWER_PAGE_SIZE,
  POWER_TYPES,
  comparePowerVersions,
  type CustomResourceRecord,
  type ListPowersInput,
  type ListPowersResult,
  type PowerSeries,
  type PowerSource,
  type PowerType,
} from './contracts'

/**
 * A single record from `apm list --json` (market) or
 * `apm list --installed --agent=<agent> --json` (installed).
 *
 * Since apm ADR-029 / ADR-040, `list --json` is a complete machine contract: each record
 * always carries `description` (empty as `""`), `tags` (empty as `[]`, never `null`) and
 * the v2 display fields `name_zh`/`name_en`/`description_zh` (empty as `""`), with
 * installed records adding `agent`. Fields stay optional here so output from an older apm
 * (or an APC catalog that predates the display fields) is tolerated: missing or blank
 * values normalize to absent, and the UI falls back to `name`/`description`.
 */
export interface APMPowerRecord {
  agent: string
  type: PowerType
  name: string
  version: string
  description?: string
  tags?: string[]
  /** Power resource format v2 display fields; emitted by apm but blank for V1 records. */
  name_zh?: string
  name_en?: string
  description_zh?: string
}

/**
 * A normalized, de-duplicated Power record ready for series aggregation.
 * The `agent` dimension is resolved before aggregation (per-agent CLI call).
 *
 * `version` is empty only for a hand-installed (`source: 'custom'`) resource
 * whose authority file declares none: the directory itself is the installed
 * unit, so there is no version to fall back to. `source` marks a record that
 * came from the custom scan rather than from the APM manifest.
 */
export interface PowerRecord {
  type: PowerType
  name: string
  version: string
  description: string
  tags: string[]
  name_zh?: string
  name_en?: string
  description_zh?: string
  source?: PowerSource
}

const VERSION_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

const POWER_TYPE_SET: ReadonlySet<string> = new Set(POWER_TYPES)

function fail(reason: string): never {
  throw new Error(`Invalid apm list output: ${reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalizes one optional v2 display field from an upstream record (apm list
 * output or an APC catalog item). A non-string value is an upstream schema
 * violation and fails loudly through the caller's `onInvalid` reporter; a missing
 * or blank value is treated as absent, so a V1 record — and a record whose author
 * left a field empty — both fall back to `name`/`description`.
 */
export function normalizeDisplayField(
  value: unknown,
  label: string,
  onInvalid: (reason: string) => never
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    onInvalid(`${label} must be a string`)
  }
  return value.trim().length === 0 ? undefined : value
}

function parseApmPowerRecord(value: unknown): APMPowerRecord {
  if (!isRecord(value)) {
    fail('each power must be an object')
  }
  const { agent, type, name, version, description, tags, name_zh, name_en, description_zh } = value

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

  const displayNameZH = normalizeDisplayField(name_zh, 'name_zh', fail)
  const displayNameEN = normalizeDisplayField(name_en, 'name_en', fail)
  const displayDescriptionZH = normalizeDisplayField(description_zh, 'description_zh', fail)

  return {
    agent,
    type: type as PowerType,
    name,
    version,
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags: [...tags] } : {}),
    ...(displayNameZH !== undefined ? { name_zh: displayNameZH } : {}),
    ...(displayNameEN !== undefined ? { name_en: displayNameEN } : {}),
    ...(displayDescriptionZH !== undefined ? { description_zh: displayDescriptionZH } : {}),
  }
}

/**
 * Parses and validates the JSON array returned by
 * `apm list --installed --agent=<agent> --json` (records always carry
 * `description`/`tags` since apm ADR-029).
 * Unknown fields are tolerated (apm owns its output schema); required identity
 * fields are type-checked, and missing `description`/`tags` normalize to `''`/`[]`.
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

/**
 * The identity of one Power series: a type plus a name, independent of version.
 * It is the key both the series map and the managed/custom split use, so a
 * scanner result and an APM manifest entry must build it the same way.
 */
export function powerSeriesKey(type: string, name: string): string {
  return `${type}\u0000${name}`
}

/**
 * Orders versions newest-first. A versionless custom resource sorts last: it is
 * the only entry of its series, and treating "no declared version" as the oldest
 * keeps a hand-installed resource from outranking a real release.
 */
function compareVersionsDescending(left: string, right: string): number {
  return -comparePowerVersions(left, right)
}

function compareSeries(left: PowerSeries, right: PowerSeries): number {
  if (left.type !== right.type) return left.type < right.type ? -1 : 1
  if (left.name !== right.name) return left.name < right.name ? -1 : 1
  return 0
}

type PowersResultQuery = Pick<ListPowersInput, 'type' | 'tags' | 'page' | 'snapshot'>

/**
 * Picks the series-level display name from a group of records. The first
 * non-blank value wins, scanning the group in the requested order, so a group
 * whose newest resource is a V1 record still shows the display name carried by
 * an older V2 record instead of falling back to the canonical name.
 */
function firstDisplayName(
  records: readonly PowerRecord[],
  field: 'name_zh' | 'name_en'
): string | undefined {
  for (const record of records) {
    const value = record[field]
    if (value !== undefined && value.trim().length > 0) return value
  }
  return undefined
}

/**
 * Shared series aggregation + closed-DTO result assembly for a set of normalized
 * records. Filters by type, then by tag AND on exact versions (a version must
 * carry every selected tag), groups into series, sorts versions SemVer-descending,
 * paginates 20 series per page, and derives `facets.tags` from the selected type's
 * full record set (ignoring tag selection). `facets.agents` is always `[]` because
 * agent discovery is not performed.
 *
 * Display fields stay display-only: `name_zh`/`name_en` are hoisted to the series
 * so the title does not flicker when the selected version changes, while
 * `description_zh` stays per version next to the `description` it translates.
 * `source` is hoisted the same way: every record of a series carries the same
 * value, so it describes the series rather than one version.
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
    // Intersection: selecting more tags narrows the list, so a version only
    // matches when it carries every selected tag.
    return query.tags.every((tag) => record.tags.includes(tag))
  })

  const groups = new Map<string, PowerRecord[]>()
  for (const record of filtered) {
    const key = `${record.type}\u0000${record.name}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(record)
    else groups.set(key, [record])
  }

  const series: PowerSeries[] = [...groups.values()].map((group) => {
    // One SemVer-descending order serves both the versions array and the display
    // names: the first record carrying a display name owns it for the series.
    const ordered = [...group].sort((left, right) =>
      compareVersionsDescending(left.version, right.version)
    )
    const versions = ordered.map((record) => ({
      version: record.version,
      description: record.description,
      tags: [...record.tags],
      ...(record.description_zh !== undefined ? { description_zh: record.description_zh } : {}),
    }))
    const nameZH = firstDisplayName(ordered, 'name_zh')
    const nameEN = firstDisplayName(ordered, 'name_en')
    const source = ordered[0].source
    return {
      type: ordered[0].type,
      name: ordered[0].name,
      versions,
      ...(nameZH !== undefined ? { name_zh: nameZH } : {}),
      ...(nameEN !== undefined ? { name_en: nameEN } : {}),
      ...(source !== undefined ? { source } : {}),
    }
  })
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

// The snapshot covers the display fields and the source too: a refresh that only
// adds or edits a display name, or that turns a hand-installed resource into a
// Hub-managed one, must still invalidate page 2 and re-render the cards.
function snapshotForRecords(records: readonly PowerRecord[]): string {
  const canonical = records
    .map(
      (record) =>
        `${record.type}\u0000${record.name}\u0000${record.version}\u0000${record.description}\u0000${record.tags.join('\u0001')}` +
        `\u0002${record.name_zh ?? ''}\u0000${record.name_en ?? ''}\u0000${record.description_zh ?? ''}` +
        `\u0003${record.source ?? ''}`
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
  return buildMergedInstalledPowersResult(query, records, [])
}

/**
 * Builds the installed-scope result from the APM manifest records plus the
 * hand-installed resources found by the custom scan.
 *
 * A custom entry whose `(type,name)` is already in the APM manifest is dropped:
 * the manifest is the authority for a Hub-managed Power, and two series with the
 * same key would collide in the frontend's series map. A custom resource is a
 * single directory, so its record always carries exactly one version.
 */
export function buildMergedInstalledPowersResult(
  query: ListPowersInput,
  records: readonly APMPowerRecord[],
  customRecords: readonly CustomResourceRecord[]
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
      ...(record.name_zh !== undefined ? { name_zh: record.name_zh } : {}),
      ...(record.name_en !== undefined ? { name_en: record.name_en } : {}),
      ...(record.description_zh !== undefined ? { description_zh: record.description_zh } : {}),
    })
  }

  const managed = new Set(normalized.map((record) => powerSeriesKey(record.type, record.name)))
  for (const record of customRecords) {
    const seriesKey = powerSeriesKey(record.type, record.name)
    if (managed.has(seriesKey)) continue
    if (normalized.some((existing) => powerSeriesKey(existing.type, existing.name) === seriesKey)) continue
    managed.add(seriesKey)
    normalized.push({
      type: record.type,
      name: record.name,
      version: record.version,
      description: record.description,
      tags: sortedUnique(record.tags),
      source: 'custom',
      ...(record.name_zh !== undefined ? { name_zh: record.name_zh } : {}),
      ...(record.name_en !== undefined ? { name_en: record.name_en } : {}),
      ...(record.description_zh !== undefined ? { description_zh: record.description_zh } : {}),
    })
  }

  return buildPowersResult(normalized, query, snapshotForRecords(normalized))
}
