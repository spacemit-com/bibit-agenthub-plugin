import type { TranslatableText } from '../agentHubI18n'
import type { APMPowerRecord } from './apm'
import type { MutationIntent, MutationResult, PowerTarget } from './powerOperations'

/**
 * The observed outcome of one mutation, either a normal subprocess exit or a
 * platform error code. It never carries raw stderr or error text.
 */
export type Execution = MutationResult | { status: 'error'; code: string }

function matchingRecord(actual: readonly APMPowerRecord[] | undefined, target: PowerTarget): APMPowerRecord | undefined {
  return actual?.find(
    (record) => record.agent === target.agent && record.type === target.type && record.name === target.name
  )
}

function installedVersion(actual: readonly APMPowerRecord[] | undefined, target: PowerTarget): string | undefined {
  return matchingRecord(actual, target)?.version
}

function matchesTarget(intent: MutationIntent, actual: readonly APMPowerRecord[] | undefined): boolean {
  if (actual === undefined) return false
  if (intent.kind === 'install') {
    return actual.some(
      (record) =>
        record.agent === intent.input.agent &&
        record.type === intent.input.type &&
        record.name === intent.input.name &&
        record.version === intent.input.version
    )
  }
  return matchingRecord(actual, intent.input) === undefined
}

/**
 * Builds a safe, user-facing message for one mutation from known evidence: the
 * intent, the observed subprocess exit or platform error code, and the
 * post-reconcile install records (undefined when the confirmation read failed).
 *
 * The message is the English source text plus the values its `{version}` slot
 * needs; the render boundary translates it into the host language. It is drawn
 * from a fixed set: it never interpolates raw stderr, never claims a rollback,
 * and never infers that apm is missing from a generic unavailable error.
 */
export function operationMessage(
  intent: MutationIntent,
  execution: Execution,
  actual: readonly APMPowerRecord[] | undefined
): TranslatableText {
  if (execution.status === 'error') {
    switch (execution.code) {
      case 'unauthorized':
        return { text: 'This installation is not authorized for that operation; do not retry.' }
      case 'incompatible':
        return { text: 'The current provider does not support that operation; do not retry.' }
      case 'timeout':
      case 'cancelled':
      case 'offline':
        return { text: 'The operation result needs confirmation; refresh to read the actual state.' }
      case 'unavailable':
        return { text: 'The operation is unavailable; the installed state could not be confirmed.' }
      default:
        return actual === undefined
          ? { text: 'The command failed and the current installed state could not be confirmed.' }
          : { text: 'The operation is unavailable; the installed state could not be confirmed.' }
    }
  }

  const exitCode = execution.exitCode
  if (actual === undefined) {
    return exitCode === 0
      ? { text: 'The command completed, but the installed state could not be confirmed; refresh.' }
      : { text: 'The command failed and the current installed state could not be confirmed.' }
  }

  const matches = matchesTarget(intent, actual)
  const version = installedVersion(actual, intent.input)

  if (exitCode === 0) {
    if (matches) {
      return intent.kind === 'install'
        ? { text: 'Installation complete.' }
        : { text: 'Uninstall complete.' }
    }
    return { text: 'The command finished, but the installed state does not match the expectation.' }
  }

  if (matches) {
    return intent.kind === 'install'
      ? {
          text: 'The command reported an error; version {version} is confirmed installed.',
          values: { version: version ?? '' },
        }
      : { text: 'The command reported an error; nothing is installed.' }
  }

  if (version !== undefined) {
    return {
      text: 'The command failed; version {version} is still installed.',
      values: { version },
    }
  }
  return { text: 'The command failed; nothing is installed.' }
}
