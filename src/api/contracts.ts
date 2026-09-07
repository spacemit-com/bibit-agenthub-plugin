export const POWER_TYPES = ['skill', 'plugin', 'mcp', 'agent'] as const
export const POWER_PAGE_SIZE = 20 as const
export const POWERS_LIST_OPERATION_ID = 'powers.list.v1' as const

// Frontend-fixed installed agent list. Installed data is fetched per-agent from the
// apm CLI (`apm list --installed --agent=<agent> --json`, records always carry
// description/tags since apm ADR-029); no `--agent=all` discovery is done, so the
// Agent menu renders exactly these ids. `claude-code` is apm's id for "claude".
export const INSTALLED_AGENTS = ['bibit', 'codex', 'claude-code'] as const

export type PowerScope = 'installed' | 'market'
export type PowerType = (typeof POWER_TYPES)[number]

export interface ListPowersInput {
  scope: PowerScope
  agent?: string
  type: PowerType
  tags: string[]
  page: number
  pageSize: 20
  snapshot?: string
}

export interface PowerVersion {
  version: string
  description: string
  tags: string[]
}

export interface PowerSeries {
  type: PowerType
  name: string
  versions: PowerVersion[]
}

export interface PowerWarning {
  code: 'installed-agent-unavailable'
  agent: string
  message: string
}

export type ListPowersResult =
  | {
      status: 'ready'
      snapshot: string
      items: PowerSeries[]
      page: number
      pageSize: 20
      total: number
      nextPage?: number
      facets: {
        agents: string[]
        tags: string[]
      }
      warnings: PowerWarning[]
    }
  | {
      status: 'reset_required'
      reason: 'snapshot_changed'
    }

export type ReadyListPowersResult = Extract<ListPowersResult, { status: 'ready' }>

// Raw wire envelope between the frontend data layer and the stdio provider. The
// provider carries original JSON text (no business parsing), so these fields are
// closed unions validated at the API boundary; business entries stay unparsed here.
export type PowersWireInput =
  | { scope: 'installed'; agent: string }
  | { scope: 'market'; knownSnapshot?: string }

export type PowersWireResult =
  | { scope: 'installed'; status: 'data'; listJson: string }
  | { scope: 'market'; status: 'data'; snapshot: string; catalogJson: string }
  | { scope: 'market'; status: 'not_modified'; snapshot: string }

const RESULT_PREFIX = 'Invalid powers.list.v1 result:'
const REQUEST_PREFIX = 'Invalid powers.list.v1 request:'
const WIRE_REQUEST_PREFIX = 'Invalid powers.list.v1 wire request:'
const WIRE_RESULT_PREFIX = 'Invalid powers.list.v1 wire result:'

const VERSION_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

const SERIES_KEYS = new Set(['type', 'name', 'versions'])
const VERSION_KEYS = new Set(['version', 'description', 'tags'])
const FACETS_KEYS = new Set(['agents', 'tags'])
const WARNING_KEYS = new Set(['code', 'agent', 'message'])
const WARNING_CODES = new Set(['installed-agent-unavailable'])
const READY_KEYS = new Set([
  'status',
  'snapshot',
  'items',
  'page',
  'pageSize',
  'total',
  'nextPage',
  'facets',
  'warnings',
])
const RESET_KEYS = new Set(['status', 'reason'])
const INPUT_KEYS = new Set(['scope', 'agent', 'type', 'tags', 'page', 'pageSize', 'snapshot'])

function fail(prefix: string, reason: string): never {
  throw new Error(`${prefix} ${reason}`)
}

function assertObject(value: unknown, prefix: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(prefix, 'expected a plain object')
  }
  return value as Record<string, unknown>
}

function assertClosedKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prefix: string
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(prefix, 'unexpected field')
    }
  }
}

function assertString(value: unknown, prefix: string, label: string): string {
  if (typeof value !== 'string') {
    fail(prefix, `${label} must be a string`)
  }
  return value
}

function assertNonEmptyString(value: unknown, prefix: string, label: string): string {
  const result = assertString(value, prefix, label)
  if (result.length === 0) {
    fail(prefix, `${label} must be non-empty`)
  }
  return result
}

function assertInteger(value: unknown, prefix: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(prefix, 'expected a finite integer')
  }
  return value
}

function assertPositiveInteger(value: unknown, prefix: string, label: string): number {
  const result = assertInteger(value, prefix)
  if (result < 1) {
    fail(prefix, `${label} must be at least 1`)
  }
  return result
}

function assertNonNegativeInteger(value: unknown, prefix: string, label: string): number {
  const result = assertInteger(value, prefix)
  if (result < 0) {
    fail(prefix, `${label} must be non-negative`)
  }
  return result
}

function assertPageSize(value: unknown, prefix: string): typeof POWER_PAGE_SIZE {
  if (value !== POWER_PAGE_SIZE) {
    fail(prefix, `pageSize must be ${POWER_PAGE_SIZE}`)
  }
  return POWER_PAGE_SIZE
}

function assertPowerType(value: unknown, prefix: string): PowerType {
  if (typeof value !== 'string' || !(POWER_TYPES as readonly string[]).includes(value)) {
    fail(prefix, 'invalid power type')
  }
  return value as PowerType
}

function assertSortedUniqueStrings(
  value: unknown,
  prefix: string,
  label: string,
  maxLength?: number
): string[] {
  if (!Array.isArray(value)) {
    fail(prefix, `${label} must be an array`)
  }
  if (maxLength !== undefined && value.length > maxLength) {
    fail(prefix, `${label} must have at most ${maxLength} items`)
  }
  const result = value.map((item) => {
    if (typeof item !== 'string' || item.length === 0) {
      fail(prefix, `${label} must contain non-empty strings`)
    }
    return item
  })
  for (let i = 1; i < result.length; i++) {
    if (result[i] <= result[i - 1]) {
      fail(prefix, `${label} must be sorted and unique`)
    }
  }
  return result
}

function assertVersionString(value: unknown, prefix: string): string {
  const result = assertString(value, prefix, 'version')
  if (!VERSION_PATTERN.test(result)) {
    fail(prefix, 'invalid version')
  }
  return result
}

function parseVersionParts(version: string): [number, number, number] {
  const match = VERSION_PATTERN.exec(version)!
  const [, major, minor, patch] = match
  return [Number(major), Number(minor), Number(patch)]
}

function compareVersions(a: string, b: string): number {
  const [amajor, aminor, apatch] = parseVersionParts(a)
  const [bmajor, bminor, bpatch] = parseVersionParts(b)
  if (amajor !== bmajor) return amajor - bmajor
  if (aminor !== bminor) return aminor - bminor
  return apatch - bpatch
}

function assertDescendingVersions(versions: PowerVersion[]): void {
  for (let i = 1; i < versions.length; i++) {
    if (compareVersions(versions[i - 1].version, versions[i].version) <= 0) {
      fail(RESULT_PREFIX, 'versions must be in descending order')
    }
  }
}

function assertSortedSeries(items: PowerSeries[]): void {
  for (let i = 1; i < items.length; i++) {
    const previous = items[i - 1]
    const current = items[i]
    if (
      previous.type > current.type ||
      (previous.type === current.type && previous.name >= current.name)
    ) {
      fail(RESULT_PREFIX, 'items must be sorted by type then name')
    }
  }
}

function parsePowerVersion(value: unknown): PowerVersion {
  const obj = assertObject(value, RESULT_PREFIX)
  assertClosedKeys(obj, VERSION_KEYS, RESULT_PREFIX)
  const version = assertVersionString(obj.version, RESULT_PREFIX)
  const description = assertString(obj.description, RESULT_PREFIX, 'description')
  const tags = assertSortedUniqueStrings(obj.tags, RESULT_PREFIX, 'tags')
  return { version, description, tags }
}

function parsePowerSeries(value: unknown): PowerSeries {
  const obj = assertObject(value, RESULT_PREFIX)
  assertClosedKeys(obj, SERIES_KEYS, RESULT_PREFIX)
  const type = assertPowerType(obj.type, RESULT_PREFIX)
  const name = assertNonEmptyString(obj.name, RESULT_PREFIX, 'name')
  const versionsRaw = obj.versions
  if (!Array.isArray(versionsRaw)) {
    fail(RESULT_PREFIX, 'versions must be an array')
  }
  if (versionsRaw.length === 0) {
    fail(RESULT_PREFIX, 'versions must not be empty')
  }
  const versions = versionsRaw.map(parsePowerVersion)
  assertDescendingVersions(versions)
  return { type, name, versions }
}

function parseFacets(value: unknown): { agents: string[]; tags: string[] } {
  const obj = assertObject(value, RESULT_PREFIX)
  assertClosedKeys(obj, FACETS_KEYS, RESULT_PREFIX)
  const agents = assertSortedUniqueStrings(obj.agents, RESULT_PREFIX, 'agents')
  const tags = assertSortedUniqueStrings(obj.tags, RESULT_PREFIX, 'tags')
  return { agents, tags }
}

function parsePowerWarning(value: unknown): PowerWarning {
  const obj = assertObject(value, RESULT_PREFIX)
  assertClosedKeys(obj, WARNING_KEYS, RESULT_PREFIX)
  const code = obj.code
  if (typeof code !== 'string' || !WARNING_CODES.has(code)) {
    fail(RESULT_PREFIX, 'invalid warning code')
  }
  const agent = assertNonEmptyString(obj.agent, RESULT_PREFIX, 'agent')
  const message = assertString(obj.message, RESULT_PREFIX, 'message')
  return { code: code as PowerWarning['code'], agent, message }
}

function parseReadyResult(obj: Record<string, unknown>): ListPowersResult {
  assertClosedKeys(obj, READY_KEYS, RESULT_PREFIX)
  const snapshot = assertNonEmptyString(obj.snapshot, RESULT_PREFIX, 'snapshot')
  const itemsRaw = obj.items
  if (!Array.isArray(itemsRaw)) {
    fail(RESULT_PREFIX, 'items must be an array')
  }
  const items = itemsRaw.map(parsePowerSeries)
  assertSortedSeries(items)
  const page = assertPositiveInteger(obj.page, RESULT_PREFIX, 'page')
  const pageSize = assertPageSize(obj.pageSize, RESULT_PREFIX)
  const total = assertNonNegativeInteger(obj.total, RESULT_PREFIX, 'total')
  let nextPage: number | undefined
  if (obj.nextPage !== undefined) {
    nextPage = assertPositiveInteger(obj.nextPage, RESULT_PREFIX, 'nextPage')
  }
  const facets = parseFacets(obj.facets)
  const warningsRaw = obj.warnings
  if (!Array.isArray(warningsRaw)) {
    fail(RESULT_PREFIX, 'warnings must be an array')
  }
  const warnings = warningsRaw.map(parsePowerWarning)
  return {
    status: 'ready',
    snapshot,
    items,
    page,
    pageSize,
    total,
    ...(nextPage !== undefined ? { nextPage } : {}),
    facets,
    warnings,
  }
}

function parseResetResult(obj: Record<string, unknown>): ListPowersResult {
  assertClosedKeys(obj, RESET_KEYS, RESULT_PREFIX)
  if (obj.reason !== 'snapshot_changed') {
    fail(RESULT_PREFIX, 'invalid reset reason')
  }
  return { status: 'reset_required', reason: 'snapshot_changed' }
}

export function parseListPowersResult(value: unknown): ListPowersResult {
  const obj = assertObject(value, RESULT_PREFIX)
  const status = obj.status
  if (status === 'ready') {
    return parseReadyResult(obj)
  }
  if (status === 'reset_required') {
    return parseResetResult(obj)
  }
  fail(RESULT_PREFIX, 'unknown status')
}

export function parseListPowersInput(value: unknown): ListPowersInput {
  const obj = assertObject(value, REQUEST_PREFIX)
  assertClosedKeys(obj, INPUT_KEYS, REQUEST_PREFIX)

  const scope = obj.scope
  if (scope !== 'installed' && scope !== 'market') {
    fail(REQUEST_PREFIX, 'invalid scope')
  }

  const hasAgent = Object.prototype.hasOwnProperty.call(obj, 'agent')
  let agent: string | undefined
  if (scope === 'installed') {
    if (!hasAgent) {
      fail(REQUEST_PREFIX, 'agent is required for installed scope')
    }
    const rawAgent = obj.agent
    if (typeof rawAgent !== 'string' || rawAgent.trim() === '') {
      fail(REQUEST_PREFIX, 'agent must be a non-empty string')
    }
    agent = rawAgent
  } else if (hasAgent) {
    fail(REQUEST_PREFIX, 'agent must be omitted for market scope')
  }

  const type = assertPowerType(obj.type, REQUEST_PREFIX)
  const tags = assertSortedUniqueStrings(obj.tags, REQUEST_PREFIX, 'tags', 20)
  const page = assertPositiveInteger(obj.page, REQUEST_PREFIX, 'page')
  const pageSize = assertPageSize(obj.pageSize, REQUEST_PREFIX)

  const hasSnapshot = Object.prototype.hasOwnProperty.call(obj, 'snapshot')
  let snapshot: string | undefined
  if (page === 1) {
    if (hasSnapshot) {
      fail(REQUEST_PREFIX, 'snapshot must be omitted on page 1')
    }
  } else {
    if (!hasSnapshot) {
      fail(REQUEST_PREFIX, 'snapshot is required after page 1')
    }
    snapshot = assertNonEmptyString(obj.snapshot, REQUEST_PREFIX, 'snapshot')
  }

  return {
    scope,
    type,
    tags,
    page,
    pageSize,
    ...(agent !== undefined ? { agent } : {}),
    ...(snapshot !== undefined ? { snapshot } : {}),
  }
}

const WIRE_INSTALLED_KEYS = new Set(['scope', 'agent'])
const WIRE_MARKET_INPUT_KEYS = new Set(['scope', 'knownSnapshot'])
const WIRE_INSTALLED_RESULT_KEYS = new Set(['scope', 'status', 'listJson'])
const WIRE_MARKET_DATA_KEYS = new Set(['scope', 'status', 'snapshot', 'catalogJson'])
const WIRE_MARKET_NOT_MODIFIED_KEYS = new Set(['scope', 'status', 'snapshot'])

export function parsePowersWireInput(value: unknown): PowersWireInput {
  const obj = assertObject(value, WIRE_REQUEST_PREFIX)
  const scope = obj.scope
  if (scope === 'installed') {
    assertClosedKeys(obj, WIRE_INSTALLED_KEYS, WIRE_REQUEST_PREFIX)
    return { scope: 'installed', agent: assertNonEmptyString(obj.agent, WIRE_REQUEST_PREFIX, 'agent') }
  }
  if (scope !== 'market') {
    fail(WIRE_REQUEST_PREFIX, 'invalid scope')
  }
  assertClosedKeys(obj, WIRE_MARKET_INPUT_KEYS, WIRE_REQUEST_PREFIX)
  if (Object.prototype.hasOwnProperty.call(obj, 'knownSnapshot')) {
    return {
      scope: 'market',
      knownSnapshot: assertNonEmptyString(obj.knownSnapshot, WIRE_REQUEST_PREFIX, 'knownSnapshot'),
    }
  }
  return { scope: 'market' }
}

export function parsePowersWireResult(value: unknown): PowersWireResult {
  const obj = assertObject(value, WIRE_RESULT_PREFIX)
  const scope = obj.scope
  if (scope === 'installed') {
    assertClosedKeys(obj, WIRE_INSTALLED_RESULT_KEYS, WIRE_RESULT_PREFIX)
    if (obj.status !== 'data') {
      fail(WIRE_RESULT_PREFIX, 'invalid status')
    }
    return { scope: 'installed', status: 'data', listJson: assertString(obj.listJson, WIRE_RESULT_PREFIX, 'listJson') }
  }
  if (scope !== 'market') {
    fail(WIRE_RESULT_PREFIX, 'invalid scope')
  }
  if (obj.status === 'data') {
    assertClosedKeys(obj, WIRE_MARKET_DATA_KEYS, WIRE_RESULT_PREFIX)
    return {
      scope: 'market',
      status: 'data',
      snapshot: assertNonEmptyString(obj.snapshot, WIRE_RESULT_PREFIX, 'snapshot'),
      catalogJson: assertString(obj.catalogJson, WIRE_RESULT_PREFIX, 'catalogJson'),
    }
  }
  if (obj.status === 'not_modified') {
    assertClosedKeys(obj, WIRE_MARKET_NOT_MODIFIED_KEYS, WIRE_RESULT_PREFIX)
    return { scope: 'market', status: 'not_modified', snapshot: assertNonEmptyString(obj.snapshot, WIRE_RESULT_PREFIX, 'snapshot') }
  }
  fail(WIRE_RESULT_PREFIX, 'invalid status')
}

export function toListPowersParams(input: ListPowersInput): Record<string, unknown> {
  return parseListPowersInput(input) as unknown as Record<string, unknown>
}
