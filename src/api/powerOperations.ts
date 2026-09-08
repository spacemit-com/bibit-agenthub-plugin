import type { FeatureServiceApiV1 } from '@bibit/feature-sdk'
import { INSTALLED_AGENTS, POWER_TYPES, type PowerType } from './contracts'
import { parseApmInstalledList, type APMPowerRecord } from './apm'

export const POWERS_INSPECT_OPERATION_ID = 'powers.inspect.v1' as const
export const POWERS_INSTALL_OPERATION_ID = 'powers.install.v1' as const
export const POWERS_UNINSTALL_OPERATION_ID = 'powers.uninstall.v1' as const

export const POWERS_READ_TIMEOUT_MS = 30_000 as const
export const POWERS_WRITE_TIMEOUT_MS = 120_000 as const

export type PowerTarget = { agent: string; type: PowerType; name: string }
export type InstallInput = PowerTarget & { version: string }
export type InspectResult = { listJson: string }
export type MutationResult = { status: 'exited'; exitCode: number }
export type MutationIntent =
  | { kind: 'install'; input: InstallInput }
  | { kind: 'uninstall'; input: PowerTarget }

const TARGET_PREFIX = 'Invalid power target:'
const INSTALL_PREFIX = 'Invalid powers.install.v1 input:'
const INSPECT_RESULT_PREFIX = 'Invalid powers.inspect.v1 result:'
const MUTATION_RESULT_PREFIX = 'Invalid powers mutation result:'

const TARGET_KEYS = new Set(['agent', 'type', 'name'])
const INSTALL_KEYS = new Set(['agent', 'type', 'name', 'version'])
const INSPECT_RESULT_KEYS = new Set(['listJson'])
const MUTATION_RESULT_KEYS = new Set(['status', 'exitCode'])

const VERSION_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const POWER_NAME_PATTERN = /^[a-z0-9-]+$/

const AGENT_SET: ReadonlySet<string> = new Set(INSTALLED_AGENTS)
const POWER_TYPE_SET: ReadonlySet<string> = new Set(POWER_TYPES)

type PlatformCode = 'cancelled' | 'incompatible'

function fail(prefix: string, reason: string): never {
  throw new Error(`${prefix} ${reason}`)
}

function platformError(code: PlatformCode, message: string): never {
  throw { version: 1, code, message, retryable: false }
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

function assertNonEmptyString(value: unknown, prefix: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(prefix, `${label} must be a non-empty string`)
  }
  return value
}

function assertString(value: unknown, prefix: string, label: string): string {
  if (typeof value !== 'string') {
    fail(prefix, `${label} must be a string`)
  }
  return value
}

function assertPowerType(value: unknown, prefix: string): PowerType {
  if (typeof value !== 'string' || !POWER_TYPE_SET.has(value)) {
    fail(prefix, 'invalid power type')
  }
  return value as PowerType
}

/**
 * Validates a Power name against apm's public canonical grammar
 * (`IsCanonicalPowerName`): 1-64 bytes of lowercase kebab case, where hyphens
 * only separate non-empty alphanumeric segments. This naturally rejects option
 * injection, paths, and install-syntax separators such as `=` and `/`.
 */
function assertPowerName(value: unknown, prefix: string): string {
  const name = assertNonEmptyString(value, prefix, 'name')
  if (
    name.length > 64 ||
    name[0] === '-' ||
    name[name.length - 1] === '-' ||
    name.includes('--') ||
    !POWER_NAME_PATTERN.test(name)
  ) {
    fail(prefix, 'name must be a canonical lowercase kebab power name')
  }
  return name
}

function assertVersion(value: unknown, prefix: string): string {
  const version = assertString(value, prefix, 'version')
  if (!VERSION_PATTERN.test(version)) {
    fail(prefix, 'version must be a canonical vMAJOR.MINOR.PATCH string')
  }
  return version
}

function parseTargetFields(obj: Record<string, unknown>, prefix: string): PowerTarget {
  const agent = assertNonEmptyString(obj.agent, prefix, 'agent')
  if (!AGENT_SET.has(agent)) {
    fail(prefix, 'agent must be one of the fixed installed agents')
  }
  const type = assertPowerType(obj.type, prefix)
  const name = assertPowerName(obj.name, prefix)
  if (type === 'agent' && agent !== 'bibit') {
    fail(prefix, 'type=agent is only available for the bibit agent')
  }
  return { agent, type, name }
}

export function parsePowerTarget(value: unknown): PowerTarget {
  const obj = assertObject(value, TARGET_PREFIX)
  assertClosedKeys(obj, TARGET_KEYS, TARGET_PREFIX)
  return parseTargetFields(obj, TARGET_PREFIX)
}

export function parseInstallInput(value: unknown): InstallInput {
  const obj = assertObject(value, INSTALL_PREFIX)
  assertClosedKeys(obj, INSTALL_KEYS, INSTALL_PREFIX)
  const target = parseTargetFields(obj, INSTALL_PREFIX)
  const version = assertVersion(obj.version, INSTALL_PREFIX)
  return { ...target, version }
}

export function parseInspectResult(value: unknown): InspectResult {
  const obj = assertObject(value, INSPECT_RESULT_PREFIX)
  assertClosedKeys(obj, INSPECT_RESULT_KEYS, INSPECT_RESULT_PREFIX)
  return { listJson: assertString(obj.listJson, INSPECT_RESULT_PREFIX, 'listJson') }
}

export function parseMutationResult(value: unknown): MutationResult {
  const obj = assertObject(value, MUTATION_RESULT_PREFIX)
  assertClosedKeys(obj, MUTATION_RESULT_KEYS, MUTATION_RESULT_PREFIX)
  if (obj.status !== 'exited') {
    fail(MUTATION_RESULT_PREFIX, 'status must be exited')
  }
  const exitCode = obj.exitCode
  if (typeof exitCode !== 'number' || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    fail(MUTATION_RESULT_PREFIX, 'exitCode must be an integer from 0 to 255')
  }
  return { status: 'exited', exitCode }
}

/**
 * Queries the exact install fact for one Power via `powers.inspect.v1`. The
 * provider returns the raw `apm list` JSON; records not belonging to the
 * requested agent/type/name are rejected as incompatible rather than being
 * treated as this item's installation fact.
 */
export async function inspectPower(
  service: FeatureServiceApiV1<'store'>,
  target: PowerTarget,
  signal: AbortSignal
): Promise<APMPowerRecord[]> {
  const parsed = parsePowerTarget(target)
  const result = parseInspectResult(
    await service.request<Record<string, unknown>>({
      serviceId: 'store',
      operationId: POWERS_INSPECT_OPERATION_ID,
      params: parsed as unknown as Record<string, unknown>,
      timeoutMs: POWERS_READ_TIMEOUT_MS,
      signal,
    })
  )
  if (signal.aborted) {
    platformError('cancelled', 'Request was cancelled.')
  }
  const records = parseApmInstalledList(JSON.parse(result.listJson))
  for (const record of records) {
    if (record.agent !== parsed.agent || record.type !== parsed.type || record.name !== parsed.name) {
      platformError('incompatible', 'Provider returned a record outside the requested target.')
    }
  }
  return records
}

/**
 * Runs one install/uninstall via the corresponding write operation. A normal
 * non-zero exit code is a result (the subprocess was observed), not a platform
 * error; platform errors from the service are preserved as-is.
 */
export async function mutatePower(
  service: FeatureServiceApiV1<'store'>,
  intent: MutationIntent,
  signal: AbortSignal
): Promise<MutationResult> {
  const operationId = intent.kind === 'install' ? POWERS_INSTALL_OPERATION_ID : POWERS_UNINSTALL_OPERATION_ID
  const input = intent.kind === 'install' ? parseInstallInput(intent.input) : parsePowerTarget(intent.input)
  return parseMutationResult(
    await service.request<Record<string, unknown>>({
      serviceId: 'store',
      operationId,
      params: input as unknown as Record<string, unknown>,
      timeoutMs: POWERS_WRITE_TIMEOUT_MS,
      signal,
    })
  )
}
