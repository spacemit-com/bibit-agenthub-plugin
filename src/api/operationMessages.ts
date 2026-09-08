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
 * The text is drawn from a fixed set: it never interpolates raw stderr, never
 * claims a rollback, and never infers that apm is missing from a generic
 * unavailable error.
 */
export function operationMessage(
  intent: MutationIntent,
  execution: Execution,
  actual: readonly APMPowerRecord[] | undefined
): string {
  if (execution.status === 'error') {
    switch (execution.code) {
      case 'unauthorized':
        return '当前安装未授权此操作，不建议重复执行'
      case 'incompatible':
        return '当前 Provider 不支持该操作，不建议重复执行'
      case 'timeout':
      case 'cancelled':
      case 'offline':
        return '操作结果待确认，请刷新实际状态'
      case 'unavailable':
        return '操作不可用，无法确认安装状态'
      default:
        return actual === undefined ? '执行异常，且无法确认当前安装状态' : '操作不可用，无法确认安装状态'
    }
  }

  const exitCode = execution.exitCode
  if (actual === undefined) {
    return exitCode === 0 ? '命令已执行完成，安装状态确认失败，请刷新' : '执行异常，且无法确认当前安装状态'
  }

  const matches = matchesTarget(intent, actual)
  const version = installedVersion(actual, intent.input)

  if (exitCode === 0) {
    if (matches) return intent.kind === 'install' ? '安装完成' : '卸载完成'
    return '命令已结束，但当前安装状态与预期不一致'
  }

  if (matches) {
    return intent.kind === 'install' ? `命令报告异常；当前已确认安装 ${version}` : '命令报告异常；当前未安装'
  }

  if (version !== undefined) {
    return `命令执行失败，当前仍安装 ${version}`
  }
  return '命令执行失败，当前未安装'
}
