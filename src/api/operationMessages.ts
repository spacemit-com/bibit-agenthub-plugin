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
 * The shared verdict behind `operationMessage` and `isRemovalConfirmed`: the
 * observed exit code plus the post-reconcile records, reduced to the one fact
 * both callers need. Computing it once keeps the wording and the page's
 * close-the-dialog decision from drifting apart.
 */
type MutationOutcome =
  | { kind: 'indeterminate' }
  | { kind: 'matched' }
  | { kind: 'stillPresent'; version: string }
  | { kind: 'mismatch' }

function mutationOutcome(
  intent: MutationIntent,
  execution: Execution,
  actual: readonly APMPowerRecord[] | undefined
): MutationOutcome {
  if (execution.status === 'error' || actual === undefined) return { kind: 'indeterminate' }
  if (matchesTarget(intent, actual)) return { kind: 'matched' }
  const version = installedVersion(actual, intent.input)
  return version !== undefined ? { kind: 'stillPresent', version } : { kind: 'mismatch' }
}

/**
 * Whether the mutation can be treated as "the target is confirmed gone", which is
 * what lets the page close the dialog of a Power that no longer exists.
 *
 * A successful uninstall obviously qualifies. So does a non-zero exit whose
 * reconcile already shows the target missing: apm reported an error, but the fact
 * the user asked for is true, and keeping the dialog open would only hide the
 * reinstall entry point. Every other case — still installed, an error code, a
 * reconcile that could not run — stays indeterminate so the dialog keeps showing
 * its reason. Install never qualifies: the Power remains on disk.
 */
export function isRemovalConfirmed(
  intent: MutationIntent,
  execution: Execution,
  actual: readonly APMPowerRecord[] | undefined
): boolean {
  if (intent.kind !== 'uninstall') return false
  // A platform error means the reconcile never ran, so nothing is known.
  if (execution.status === 'error') return false
  // For an uninstall, 'matched' already means "the reconciled list has no record
  // for this target" — with either exit code. 'stillPresent' and 'indeterminate'
  // both leave the dialog open with its reason.
  return mutationOutcome(intent, execution, actual).kind === 'matched'
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

  const outcome = mutationOutcome(intent, execution, actual)

  if (exitCode === 0) {
    if (outcome.kind === 'matched') {
      return intent.kind === 'install'
        ? { text: 'Installation complete.' }
        : { text: 'Uninstall complete.' }
    }
    return { text: 'The command finished, but the installed state does not match the expectation.' }
  }

  if (outcome.kind === 'matched') {
    return intent.kind === 'install'
      ? {
          text: 'The command reported an error; version {version} is confirmed installed.',
          values: { version: installedVersion(actual, intent.input) ?? '' },
        }
      : { text: 'The command reported an error; nothing is installed.' }
  }

  if (outcome.kind === 'stillPresent') {
    return {
      text: 'The command failed; version {version} is still installed.',
      values: { version: outcome.version },
    }
  }
  return { text: 'The command failed; nothing is installed.' }
}
