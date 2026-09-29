export const POWER_TYPES = ['skill', 'plugin', 'mcp', 'agent'] as const
export const POWER_PAGE_SIZE = 20 as const
export const POWERS_LIST_OPERATION_ID = 'powers.list.v1' as const
export const POWERS_CUSTOM_LIST_OPERATION_ID = 'powers.custom.list.v1' as const
export const POWERS_UPLOAD_OPERATION_ID = 'powers.upload.v1' as const
export const POWERS_DELETE_OPERATION_ID = 'powers.delete.v1' as const

/**
 * Where a listed Power came from. `custom` marks a resource the user installed
 * into the Agent's own directory tree by hand, so the card and the actions are
 * presented differently from a Hub-managed resource.
 */
export type PowerSource = 'custom'

/** Closed set of reasons a candidate directory was not listed. */
export const CUSTOM_SKIP_REASONS = ['missing-authority-file', 'invalid-authority-file'] as const
export type CustomSkipReason = (typeof CUSTOM_SKIP_REASONS)[number]

// Frontend-fixed installed agent list. Installed data is fetched per-agent from the
// apm CLI (`apm list --installed --agent=<agent> --json`, records always carry
// description/tags since apm ADR-029); no `--agent=all` discovery is done, so the
// Agent menu renders exactly these ids. `claude-code` is apm's id for "claude".
export const INSTALLED_AGENTS = ['bibit', 'codex', 'claude-code', 'hermes-agent'] as const

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

/**
 * A Power display description. `description` is the agent-facing source text that
 * V1 resources carry; `description_zh` arrives with Power resource format v2 and
 * is display-only. Both are optional so a V1 record stays valid.
 *
 * `version` is empty only for a custom resource whose authority file declares no
 * version: the directory itself is the installed unit, so the card shows a
 * placeholder instead of inventing one.
 */
export interface PowerVersion {
  version: string
  description: string
  tags: string[]
  description_zh?: string
  source?: PowerSource
}

/**
 * A Power series keyed by its canonical call name. `name_zh`/`name_en` are the
 * v2 display-only names and stay optional for V1 records; `name` remains the
 * identity used for every request, key and comparison.
 */
export interface PowerSeries {
  type: PowerType
  name: string
  versions: PowerVersion[]
  name_zh?: string
  name_en?: string
  source?: PowerSource
}

export type PowerWarningCode =
  | 'installed-agent-unavailable'
  | 'custom-resources-unavailable'
  | 'custom-resource-skipped'

export interface PowerWarning {
  code: PowerWarningCode
  agent: string
  message: string
  /**
   * Placeholder values for the (English source) message. The message stays a
   * translatable template outside React, so the render boundary fills it.
   */
  values?: Record<string, string>
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
const CUSTOM_REQUEST_PREFIX = 'Invalid powers.custom.list.v1 request:'
const CUSTOM_RESULT_PREFIX = 'Invalid powers.custom.list.v1 result:'
const UPLOAD_INPUT_PREFIX = 'Invalid powers.upload.v1 input:'
const UPLOAD_RESULT_PREFIX = 'Invalid powers.upload.v1 result:'
const DELETE_TARGET_PREFIX = 'Invalid powers.delete.v1 input:'
const DELETE_RESULT_PREFIX = 'Invalid powers.delete.v1 result:'

const VERSION_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

const SERIES_KEYS = new Set(['type', 'name', 'versions', 'name_zh', 'name_en', 'source'])
const VERSION_KEYS = new Set(['version', 'description', 'tags', 'description_zh', 'source'])
const FACETS_KEYS = new Set(['agents', 'tags'])
const WARNING_KEYS = new Set(['code', 'agent', 'message', 'values'])
const WARNING_CODES = new Set([
  'installed-agent-unavailable',
  'custom-resources-unavailable',
  'custom-resource-skipped',
])
const CUSTOM_REQUEST_KEYS = new Set(['agent'])
const CUSTOM_RESULT_KEYS = new Set(['scope', 'status', 'itemsJson'])
const CUSTOM_ITEM_KEYS = new Set([
  'type',
  'name',
  'version',
  'description',
  'tags',
  'source',
  'name_zh',
  'name_en',
  'description_zh',
])
const CUSTOM_SKIPPED_KEYS = new Set(['type', 'name', 'expected', 'reason'])
const CUSTOM_DOCUMENT_KEYS = new Set(['items', 'skipped'])
const UPLOAD_INPUT_KEYS = new Set(['agent', 'type', 'name', 'message'])
const UPLOAD_RESULT_KEYS = new Set(['status', 'exitCode', 'stage', 'reason', 'stdout'])
const DELETE_TARGET_KEYS = new Set(['agent', 'type', 'name'])
const DELETE_RESULT_KEYS = new Set(['status'])
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

/**
 * Reads an optional v2 display field. A missing field is legal (V1 record) and
 * stays absent, so the render boundary can tell "no display name" apart from an
 * empty string; a present field must be a non-blank string.
 */
function parseOptionalDisplayText(
  value: unknown,
  prefix: string,
  label: string
): string | undefined {
  if (value === undefined) return undefined
  const result = assertString(value, prefix, label)
  if (result.trim().length === 0) {
    fail(prefix, `${label} must be non-empty when present`)
  }
  return result
}

function parsePowerVersion(value: unknown): PowerVersion {
  const obj = assertObject(value, RESULT_PREFIX)
  assertClosedKeys(obj, VERSION_KEYS, RESULT_PREFIX)
  const version = assertVersionString(obj.version, RESULT_PREFIX)
  const description = assertString(obj.description, RESULT_PREFIX, 'description')
  const tags = assertSortedUniqueStrings(obj.tags, RESULT_PREFIX, 'tags')
  const descriptionZH = parseOptionalDisplayText(obj.description_zh, RESULT_PREFIX, 'description_zh')
  return {
    version,
    description,
    tags,
    ...(descriptionZH !== undefined ? { description_zh: descriptionZH } : {}),
  }
}

/**
 * A custom resource is a directory the user installed by hand, so the directory
 * itself is the installed unit: exactly one version entry, and an empty version
 * when the authority file declares none. A non-empty version must still be
 * canonical, because the rest of the data layer compares and displays versions.
 */
function parseCustomPowerVersion(value: unknown): PowerVersion {
  const obj = assertObject(value, RESULT_PREFIX)
  assertClosedKeys(obj, VERSION_KEYS, RESULT_PREFIX)
  const versionRaw = obj.version
  if (typeof versionRaw !== 'string') {
    fail(RESULT_PREFIX, 'version must be a string')
  }
  if (versionRaw !== '' && !VERSION_PATTERN.test(versionRaw)) {
    fail(RESULT_PREFIX, 'invalid version')
  }
  const description = assertString(obj.description, RESULT_PREFIX, 'description')
  const tags = assertSortedUniqueStrings(obj.tags, RESULT_PREFIX, 'tags')
  if (tags.length !== 0) {
    fail(RESULT_PREFIX, 'a custom resource must not declare tags')
  }
  const descriptionZH = parseOptionalDisplayText(obj.description_zh, RESULT_PREFIX, 'description_zh')
  return {
    version: versionRaw,
    description,
    tags,
    ...(descriptionZH !== undefined ? { description_zh: descriptionZH } : {}),
  }
}

function assertPowerSource(value: unknown, prefix: string): PowerSource | undefined {
  if (value === undefined) return undefined
  if (value !== 'custom') {
    fail(prefix, 'invalid source')
  }
  return value
}

function parsePowerSeries(value: unknown): PowerSeries {
  const obj = assertObject(value, RESULT_PREFIX)
  assertClosedKeys(obj, SERIES_KEYS, RESULT_PREFIX)
  const type = assertPowerType(obj.type, RESULT_PREFIX)
  const name = assertNonEmptyString(obj.name, RESULT_PREFIX, 'name')
  const nameZH = parseOptionalDisplayText(obj.name_zh, RESULT_PREFIX, 'name_zh')
  const nameEN = parseOptionalDisplayText(obj.name_en, RESULT_PREFIX, 'name_en')
  const source = assertPowerSource(obj.source, RESULT_PREFIX)
  const versionsRaw = obj.versions
  if (!Array.isArray(versionsRaw)) {
    fail(RESULT_PREFIX, 'versions must be an array')
  }
  if (versionsRaw.length === 0) {
    fail(RESULT_PREFIX, 'versions must not be empty')
  }
  if (source === 'custom' && versionsRaw.length !== 1) {
    fail(RESULT_PREFIX, 'a custom resource must carry exactly one version')
  }
  const versions = versionsRaw.map(source === 'custom' ? parseCustomPowerVersion : parsePowerVersion)
  assertDescendingVersions(versions)
  return {
    type,
    name,
    versions,
    ...(nameZH !== undefined ? { name_zh: nameZH } : {}),
    ...(nameEN !== undefined ? { name_en: nameEN } : {}),
    ...(source !== undefined ? { source } : {}),
  }
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
  let values: Record<string, string> | undefined
  if (obj.values !== undefined) {
    const raw = assertObject(obj.values, RESULT_PREFIX)
    values = {}
    for (const [key, entry] of Object.entries(raw)) {
      if (key.length === 0 || typeof entry !== 'string') {
        fail(RESULT_PREFIX, 'warning values must be string entries')
      }
      values[key] = entry
    }
  }
  return {
    code: code as PowerWarning['code'],
    agent,
    message,
    ...(values !== undefined ? { values } : {}),
  }
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

// ---- custom resources -----------------------------------------------------

/**
 * One hand-installed resource as the scanner reports it. Identity is the
 * directory name; the `name` declared in the authority file is display-only, so a
 * mismatch is not an error. The scanner projects that declared name into
 * `name_en` when the resource declares no `name_en`, which is what keeps a V1
 * resource's card from showing the directory it happens to sit in.
 * `version` may be empty when the file declares none.
 */
export interface CustomResourceRecord {
  type: PowerType
  name: string
  version: string
  description: string
  tags: string[]
  source: PowerSource
  name_zh?: string
  name_en?: string
  description_zh?: string
}

/** One candidate directory the scanner refused to list, with its reason. */
export interface CustomResourceSkipped {
  type: PowerType
  name: string
  expected: string
  reason: CustomSkipReason
}

export interface CustomResourceList {
  items: CustomResourceRecord[]
  skipped: CustomResourceSkipped[]
}

export interface CustomListInput {
  agent: string
}

export interface CustomListResult {
  scope: 'custom'
  status: 'data'
  itemsJson: string
}

export interface UploadInput {
  agent: string
  type: PowerType
  name: string
  message: string
}

export type UploadStage = 'validate' | 'submit'

export interface UploadResult {
  status: 'exited'
  exitCode: number
  stage: UploadStage
  reason?: string
  stdout?: string
}

export interface DeleteResult {
  status: 'deleted'
}

const POWER_NAME_PATTERN = /^[a-z0-9-]+$/
const AGENT_SET: ReadonlySet<string> = new Set(INSTALLED_AGENTS)
const POWER_TYPE_SET: ReadonlySet<string> = new Set(POWER_TYPES)
const SKIP_REASON_SET: ReadonlySet<string> = new Set(CUSTOM_SKIP_REASONS)

/**
 * Validates one `(agent,type,name)` triple the same way the provider does: the
 * agent must be a fixed installed agent, the type one of the four Power types,
 * and the name a canonical lowercase kebab name. Reusing the rule on both sides
 * keeps a rejected request from ever reaching the provider's filesystem join.
 */
function parseResourceTarget(
  obj: Record<string, unknown>,
  prefix: string
): { agent: string; type: PowerType; name: string } {
  const agent = assertNonEmptyString(obj.agent, prefix, 'agent')
  if (!AGENT_SET.has(agent)) {
    fail(prefix, 'agent must be a fixed installed agent')
  }
  const type = assertPowerType(obj.type, prefix)
  const name = assertNonEmptyString(obj.name, prefix, 'name')
  if (
    name.length > 64 ||
    name[0] === '-' ||
    name[name.length - 1] === '-' ||
    name.includes('--') ||
    !POWER_NAME_PATTERN.test(name)
  ) {
    fail(prefix, 'name must be a canonical lowercase kebab power name')
  }
  if (type === 'agent' && agent !== 'bibit') {
    fail(prefix, 'type=agent is only available for the bibit agent')
  }
  return { agent, type, name }
}

export function parseCustomListInput(value: unknown): CustomListInput {
  const obj = assertObject(value, CUSTOM_REQUEST_PREFIX)
  assertClosedKeys(obj, CUSTOM_REQUEST_KEYS, CUSTOM_REQUEST_PREFIX)
  const agent = assertNonEmptyString(obj.agent, CUSTOM_REQUEST_PREFIX, 'agent')
  if (!AGENT_SET.has(agent)) {
    fail(CUSTOM_REQUEST_PREFIX, 'agent must be a fixed installed agent')
  }
  return { agent }
}

export function parseCustomListResult(value: unknown): CustomListResult {
  const obj = assertObject(value, CUSTOM_RESULT_PREFIX)
  assertClosedKeys(obj, CUSTOM_RESULT_KEYS, CUSTOM_RESULT_PREFIX)
  if (obj.scope !== 'custom') {
    fail(CUSTOM_RESULT_PREFIX, 'invalid scope')
  }
  if (obj.status !== 'data') {
    fail(CUSTOM_RESULT_PREFIX, 'invalid status')
  }
  return { scope: 'custom', status: 'data', itemsJson: assertString(obj.itemsJson, CUSTOM_RESULT_PREFIX, 'itemsJson') }
}

function parseCustomResourceRecord(value: unknown): CustomResourceRecord {
  const obj = assertObject(value, CUSTOM_RESULT_PREFIX)
  assertClosedKeys(obj, CUSTOM_ITEM_KEYS, CUSTOM_RESULT_PREFIX)
  const type = assertPowerType(obj.type, CUSTOM_RESULT_PREFIX)
  const name = assertNonEmptyString(obj.name, CUSTOM_RESULT_PREFIX, 'name')
  const version = assertString(obj.version, CUSTOM_RESULT_PREFIX, 'version')
  if (version !== '' && !VERSION_PATTERN.test(version)) {
    fail(CUSTOM_RESULT_PREFIX, 'invalid version')
  }
  if (obj.source !== 'custom') {
    fail(CUSTOM_RESULT_PREFIX, 'invalid source')
  }
  const description = assertString(obj.description, CUSTOM_RESULT_PREFIX, 'description')
  const tags = assertSortedUniqueStrings(obj.tags, CUSTOM_RESULT_PREFIX, 'tags')
  if (tags.length !== 0) {
    fail(CUSTOM_RESULT_PREFIX, 'a custom resource must not declare tags')
  }
  const nameZH = parseOptionalDisplayText(obj.name_zh, CUSTOM_RESULT_PREFIX, 'name_zh')
  const nameEN = parseOptionalDisplayText(obj.name_en, CUSTOM_RESULT_PREFIX, 'name_en')
  const descriptionZH = parseOptionalDisplayText(
    obj.description_zh,
    CUSTOM_RESULT_PREFIX,
    'description_zh'
  )
  return {
    type,
    name,
    version,
    description,
    tags,
    source: 'custom',
    ...(nameZH !== undefined ? { name_zh: nameZH } : {}),
    ...(nameEN !== undefined ? { name_en: nameEN } : {}),
    ...(descriptionZH !== undefined ? { description_zh: descriptionZH } : {}),
  }
}

function parseCustomResourceSkipped(value: unknown): CustomResourceSkipped {
  const obj = assertObject(value, CUSTOM_RESULT_PREFIX)
  assertClosedKeys(obj, CUSTOM_SKIPPED_KEYS, CUSTOM_RESULT_PREFIX)
  const type = assertPowerType(obj.type, CUSTOM_RESULT_PREFIX)
  const name = assertNonEmptyString(obj.name, CUSTOM_RESULT_PREFIX, 'name')
  const expected = assertNonEmptyString(obj.expected, CUSTOM_RESULT_PREFIX, 'expected')
  const reason = obj.reason
  if (typeof reason !== 'string' || !SKIP_REASON_SET.has(reason)) {
    fail(CUSTOM_RESULT_PREFIX, 'invalid skip reason')
  }
  return { type, name, expected, reason: reason as CustomSkipReason }
}

/**
 * Parses the scanner document carried by `itemsJson`. The provider owns the
 * scan, but this is still a protocol boundary, so the whole document is closed
 * and ordering is enforced: the result feeds a deterministic snapshot, and an
 * unstable order would invalidate page 2 on every read.
 */
export function parseCustomResourceList(value: unknown): CustomResourceList {
  const obj = assertObject(value, CUSTOM_RESULT_PREFIX)
  assertClosedKeys(obj, CUSTOM_DOCUMENT_KEYS, CUSTOM_RESULT_PREFIX)
  const itemsRaw = obj.items
  if (!Array.isArray(itemsRaw)) {
    fail(CUSTOM_RESULT_PREFIX, 'items must be an array')
  }
  const items = itemsRaw.map(parseCustomResourceRecord)
  for (let i = 1; i < items.length; i++) {
    const previous = items[i - 1]
    const current = items[i]
    if (previous.type > current.type || (previous.type === current.type && previous.name >= current.name)) {
      fail(CUSTOM_RESULT_PREFIX, 'items must be sorted by type then name')
    }
  }
  const skippedRaw = obj.skipped
  if (!Array.isArray(skippedRaw)) {
    fail(CUSTOM_RESULT_PREFIX, 'skipped must be an array')
  }
  return { items, skipped: skippedRaw.map(parseCustomResourceSkipped) }
}

export function parseUploadInput(value: unknown): UploadInput {
  const obj = assertObject(value, UPLOAD_INPUT_PREFIX)
  assertClosedKeys(obj, UPLOAD_INPUT_KEYS, UPLOAD_INPUT_PREFIX)
  const target = parseResourceTarget(obj, UPLOAD_INPUT_PREFIX)
  const message = assertString(obj.message, UPLOAD_INPUT_PREFIX, 'message')
  if (message.trim().length === 0) {
    fail(UPLOAD_INPUT_PREFIX, 'message must not be blank')
  }
  if (message.length > 200 || /[\u0000-\u001f\u007f]/.test(message)) {
    fail(UPLOAD_INPUT_PREFIX, 'message must be a single line of at most 200 characters')
  }
  return { ...target, message }
}

export function parseUploadResult(value: unknown): UploadResult {
  const obj = assertObject(value, UPLOAD_RESULT_PREFIX)
  assertClosedKeys(obj, UPLOAD_RESULT_KEYS, UPLOAD_RESULT_PREFIX)
  if (obj.status !== 'exited') {
    fail(UPLOAD_RESULT_PREFIX, 'invalid status')
  }
  const exitCode = obj.exitCode
  if (typeof exitCode !== 'number' || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    fail(UPLOAD_RESULT_PREFIX, 'exitCode must be an integer from 0 to 255')
  }
  const stage = obj.stage
  if (stage !== 'validate' && stage !== 'submit') {
    fail(UPLOAD_RESULT_PREFIX, 'invalid stage')
  }
  const reason = obj.reason === undefined ? undefined : assertString(obj.reason, UPLOAD_RESULT_PREFIX, 'reason')
  const stdout = obj.stdout === undefined ? undefined : assertString(obj.stdout, UPLOAD_RESULT_PREFIX, 'stdout')
  return {
    status: 'exited',
    exitCode,
    stage,
    ...(reason !== undefined ? { reason } : {}),
    ...(stdout !== undefined ? { stdout } : {}),
  }
}

export function parseDeleteResult(value: unknown): DeleteResult {
  const obj = assertObject(value, DELETE_RESULT_PREFIX)
  assertClosedKeys(obj, DELETE_RESULT_KEYS, DELETE_RESULT_PREFIX)
  if (obj.status !== 'deleted') {
    fail(DELETE_RESULT_PREFIX, 'invalid status')
  }
  return { status: 'deleted' }
}

export function parseDeleteTarget(value: unknown): { agent: string; type: PowerType; name: string } {
  const obj = assertObject(value, DELETE_TARGET_PREFIX)
  assertClosedKeys(obj, DELETE_TARGET_KEYS, DELETE_TARGET_PREFIX)
  return parseResourceTarget(obj, DELETE_TARGET_PREFIX)
}

// ---- settings -------------------------------------------------------------

/**
 * The settings view returned by `settings.get.v1` / `settings.update.v1`. The
 * API key is never returned: the page only learns whether one is configured,
 * because a renderer must not be able to read a credential back out.
 */
export interface AgentHubSettingsV1 {
  showExperimental: boolean
  refreshMinutes: number
  hasApiKey: boolean
}

/**
 * The settings update payload. `apiKey` is optional so omitting it keeps the
 * stored key; an empty string clears it.
 */
export interface AgentHubSettingsUpdateV1 {
  showExperimental: boolean
  refreshMinutes: number
  apiKey?: string
}

export const SETTINGS_GET_OPERATION_ID = 'settings.get.v1' as const
export const SETTINGS_UPDATE_OPERATION_ID = 'settings.update.v1' as const

export const SETTINGS_MIN_REFRESH_MINUTES = 5
export const SETTINGS_MAX_REFRESH_MINUTES = 120
export const SETTINGS_MAX_API_KEY_LENGTH = 512

export function parseSettingsView(value: unknown, prefix: string): AgentHubSettingsV1 {
  const obj = assertObject(value, prefix)
  const allowed = new Set(['showExperimental', 'refreshMinutes', 'hasApiKey'])
  assertClosedKeys(obj, allowed, prefix)
  if (typeof obj.showExperimental !== 'boolean') {
    fail(prefix, 'showExperimental must be a boolean')
  }
  if (typeof obj.hasApiKey !== 'boolean') {
    fail(prefix, 'hasApiKey must be a boolean')
  }
  return {
    showExperimental: obj.showExperimental,
    refreshMinutes: assertRefreshMinutes(obj.refreshMinutes, prefix),
    hasApiKey: obj.hasApiKey,
  }
}

export function parseSettingsUpdate(value: unknown): AgentHubSettingsUpdateV1 {
  const prefix = 'Invalid settings.update.v1 input:'
  const obj = assertObject(value, prefix)
  const allowed = new Set(['showExperimental', 'refreshMinutes', 'apiKey'])
  assertClosedKeys(obj, allowed, prefix)
  if (typeof obj.showExperimental !== 'boolean') {
    fail(prefix, 'showExperimental must be a boolean')
  }
  let apiKey: string | undefined
  if (obj.apiKey !== undefined) {
    apiKey = assertString(obj.apiKey, prefix, 'apiKey')
    if (apiKey !== '' && (apiKey.length > SETTINGS_MAX_API_KEY_LENGTH || !isPrintableASCII(apiKey))) {
      fail(prefix, 'apiKey must be printable ASCII')
    }
  }
  return {
    showExperimental: obj.showExperimental,
    refreshMinutes: assertRefreshMinutes(obj.refreshMinutes, prefix),
    ...(apiKey !== undefined ? { apiKey } : {}),
  }
}

function assertRefreshMinutes(value: unknown, prefix: string): number {
  const minutes = assertInteger(value, prefix)
  if (minutes < SETTINGS_MIN_REFRESH_MINUTES || minutes > SETTINGS_MAX_REFRESH_MINUTES) {
    fail(prefix, 'refreshMinutes is out of range')
  }
  return minutes
}

function isPrintableASCII(value: string): boolean {
  return /^[\x21-\x7e]+$/.test(value)
}
