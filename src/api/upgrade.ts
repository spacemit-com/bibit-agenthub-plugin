import type { FeatureServiceApiV1 } from '@bibit/feature-sdk'
import { INSTALLED_AGENTS, POWER_TYPES } from './contracts'

export const POWERS_UPGRADE_OPERATION_ID = 'powers.upgrade.v1' as const

/**
 * The upgrade reconciles a whole Agent (or the whole machine) in one call, so it
 * is the one operation that gets the Host's maximum request budget. Two numbers
 * have to agree for that budget to exist:
 *
 *   - this request's `timeoutMs`, validated by the provider to be <= 300000, and
 *   - `requestTimeoutMs` in the provider registry drop-in.
 *
 * The Host takes the *smaller* of the two (`request.timeout_ms.min(
 * connection.request_timeout_ms)` in external_services.rs), so asking for more
 * than the registry allows is silently cut back to the registry value rather
 * than rejected. Both are 300000; changing one alone changes nothing.
 */
export const POWERS_UPGRADE_TIMEOUT_MS = 300_000 as const

/** apm's sentinel for "every Agent it detects as installed". */
export const ALL_AGENTS = 'all' as const

/** The scopes the dialog offers: the whole machine, or one Agent. */
export const UPGRADE_SCOPES = [ALL_AGENTS, ...INSTALLED_AGENTS] as const
export type UpgradeScope = (typeof UPGRADE_SCOPES)[number]

export type UpgradeItem = {
  agent: string
  type: string
  name: string
  /** Empty when apm reported no current version (a repair, or a fresh install). */
  currentVersion: string
  /** Empty when nothing was targeted, e.g. a `skipped` entry. */
  targetVersion: string
  /** apm's outcome word, passed through rather than re-typed. */
  outcome: string
  /** Set only when `outcome` is `skipped`; apm's skip reason. */
  skip: string
}

export type UpgradeResult = {
  status: 'exited'
  exitCode: number
  items: UpgradeItem[]
  /**
   * Set only when apm produced no readable result at all — an occupied lock, or
   * an apm that predates the flags. `items` is then empty and this is the
   * sanitized explanation. Never raw command output.
   */
  reason: string
}

export type UpgradeSummary = {
  /** Entries that changed the machine: upgraded, installed (repair), downgraded. */
  changed: number
  /** Entries that were already current, deliberately skipped, or planned. */
  unchanged: number
  /** Entries apm reported as failed, plus any it never reached. */
  failed: number
}

const RESULT_PREFIX = 'Invalid powers.upgrade.v1 result:'
const INPUT_PREFIX = 'Invalid powers.upgrade.v1 input:'

const INPUT_KEYS = new Set(['agent'])

const RESULT_KEYS = new Set(['status', 'exitCode', 'items', 'reason'])
const ITEM_KEYS = new Set([
  'agent',
  'type',
  'name',
  'currentVersion',
  'targetVersion',
  'outcome',
  'skip',
])

const POWER_TYPE_SET: ReadonlySet<string> = new Set(POWER_TYPES)

/**
 * apm's outcome vocabulary, split by what the machine did. These are apm's
 * stable contract (`internal/cli/upgrade_contract.go`); the names are not
 * translated here, they are only classified.
 *
 * `planned` can only appear under `--dry-run`, which this plugin never asks for;
 * it is listed as unchanged so that a future caller who adds a dry-run preview
 * cannot have it counted as a change that did not happen.
 */
const CHANGED_OUTCOMES: ReadonlySet<string> = new Set(['upgraded', 'installed', 'downgraded'])
const UNCHANGED_OUTCOMES: ReadonlySet<string> = new Set(['up-to-date', 'skipped', 'planned'])
const FAILED_OUTCOMES: ReadonlySet<string> = new Set(['failed', 'unexecuted'])

type PlatformCode = 'cancelled' | 'incompatible'

function fail(reason: string): never {
  throw new Error(`${RESULT_PREFIX} ${reason}`)
}

function failInput(reason: string): never {
  throw new Error(`${INPUT_PREFIX} ${reason}`)
}

/**
 * The scope validation the dev gateway mirrors from the provider: `all` or one of
 * the fixed Agent IDs, nothing else. Keeping it here rather than in `dev/` means
 * the mock rejects exactly what the Go side rejects.
 */
export function parseUpgradeScope(value: unknown): UpgradeScope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    failInput('expected a plain object')
  }
  const obj = value as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!INPUT_KEYS.has(key)) failInput('unexpected field')
  }
  const agent = obj.agent
  if (typeof agent !== 'string' || agent.length === 0) {
    failInput('agent must be a non-empty string')
  }
  if (!(UPGRADE_SCOPES as readonly string[]).includes(agent)) {
    failInput('agent must be all or a fixed installed agent')
  }
  return agent as UpgradeScope
}

function platformError(code: PlatformCode, message: string): never {
  throw { version: 1, code, message, retryable: false }
}

function assertObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('expected a plain object')
  }
  return value as Record<string, unknown>
}

function assertClosedKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) fail('unexpected field')
  }
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a string`)
  return value
}

function assertNonEmptyString(value: unknown, label: string): string {
  const text = assertString(value, label)
  if (text.length === 0) fail(`${label} must be a non-empty string`)
  return text
}

/**
 * One `apm upgrade --json` entry.
 *
 * `type` is checked against the closed Power vocabulary because the page renders
 * it as a Power type; `agent` is only required to be a non-empty string, since
 * apm owns that vocabulary and a fifth Agent must not turn every upgrade result
 * into a parse failure. Both versions may legitimately be empty — apm reports no
 * target version for a `skipped` entry.
 *
 * `outcome` is deliberately not checked against a set: an outcome this build
 * does not know is still the truth about what apm did, so it is carried through
 * and classified later rather than failing the response.
 */
function parseUpgradeItem(value: unknown): UpgradeItem {
  const obj = assertObject(value)
  assertClosedKeys(obj, ITEM_KEYS)
  const type = assertNonEmptyString(obj.type, 'type')
  if (!POWER_TYPE_SET.has(type)) fail('invalid power type')
  return {
    agent: assertNonEmptyString(obj.agent, 'agent'),
    type,
    name: assertNonEmptyString(obj.name, 'name'),
    currentVersion: assertString(obj.currentVersion, 'currentVersion'),
    targetVersion: assertString(obj.targetVersion, 'targetVersion'),
    outcome: assertNonEmptyString(obj.outcome, 'outcome'),
    // The provider omits `skip` when empty (`omitempty`), so an absent key and an
    // empty string mean the same thing.
    skip: obj.skip === undefined ? '' : assertString(obj.skip, 'skip'),
  }
}

export function parseUpgradeResult(value: unknown): UpgradeResult {
  const obj = assertObject(value)
  assertClosedKeys(obj, RESULT_KEYS)
  if (obj.status !== 'exited') fail('status must be exited')
  const exitCode = obj.exitCode
  if (typeof exitCode !== 'number' || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    fail('exitCode must be an integer from 0 to 255')
  }
  if (!Array.isArray(obj.items)) fail('items must be an array')
  return {
    status: 'exited',
    exitCode,
    items: obj.items.map(parseUpgradeItem),
    reason: obj.reason === undefined ? '' : assertString(obj.reason, 'reason'),
  }
}

/**
 * Counts one run into the three buckets the page reports.
 *
 * An outcome from a newer apm that this build does not know is counted as
 * changed: apm emitted it as the result of attempting an entry, so it is neither
 * a known no-op nor a known failure, and under-reporting a change is worse than
 * labelling it imprecisely.
 */
export function summarizeUpgrade(items: readonly UpgradeItem[]): UpgradeSummary {
  let changed = 0
  let unchanged = 0
  let failed = 0
  for (const item of items) {
    if (FAILED_OUTCOMES.has(item.outcome)) failed += 1
    else if (UNCHANGED_OUTCOMES.has(item.outcome)) unchanged += 1
    else if (CHANGED_OUTCOMES.has(item.outcome)) changed += 1
    else changed += 1
  }
  return { changed, unchanged, failed }
}

/**
 * Runs `apm upgrade` for one scope and returns its per-Power outcomes.
 *
 * A non-zero exit code is a *result*, not a platform error: apm renders the
 * complete result to stdout and only then fails the batch, so `exitCode` and
 * `items` together say what happened. Platform errors (timeout, cancellation,
 * an unreadable provider) are thrown as before and handled by the caller, which
 * must re-read the installed list either way — a timeout does not mean nothing
 * was upgraded.
 */
export async function upgradePowers(
  service: FeatureServiceApiV1<'store'>,
  scope: UpgradeScope,
  signal: AbortSignal
): Promise<UpgradeResult> {
  const result = parseUpgradeResult(
    await service.request<Record<string, unknown>>({
      serviceId: 'store',
      operationId: POWERS_UPGRADE_OPERATION_ID,
      params: { agent: scope },
      timeoutMs: POWERS_UPGRADE_TIMEOUT_MS,
      signal,
    })
  )
  if (signal.aborted) {
    platformError('cancelled', 'Request was cancelled.')
  }
  return result
}
