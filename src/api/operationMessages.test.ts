import { describe, expect, it } from 'vitest'
import {
  operationMessage,
  type Execution,
} from './operationMessages'
import type { APMPowerRecord } from './apm'
import type { MutationIntent } from './powerOperations'

const uninstall: MutationIntent = {
  kind: 'uninstall',
  input: { agent: 'bibit', type: 'skill', name: 'demo' },
}
const install: MutationIntent = {
  kind: 'install',
  input: { agent: 'bibit', type: 'skill', name: 'demo', version: 'v2.0.0' },
}

const record = (version: string): APMPowerRecord => ({
  agent: 'bibit',
  type: 'skill',
  name: 'demo',
  version,
  description: '',
  tags: [],
})

describe('operationMessage', () => {
  it('reports install success when exit 0 and the target version is installed', () => {
    expect(operationMessage(install, { status: 'exited', exitCode: 0 }, [record('v2.0.0')])).toBe('安装完成')
  })

  it('reports uninstall success when exit 0 and the target is gone', () => {
    expect(operationMessage(uninstall, { status: 'exited', exitCode: 0 }, [])).toBe('卸载完成')
  })

  it('reports state mismatch when exit 0 but the install target version is absent', () => {
    expect(operationMessage(install, { status: 'exited', exitCode: 0 }, [record('v1.0.0')])).toContain('与预期不一致')
  })

  it('reports state mismatch when exit 0 but an uninstalled target is still installed', () => {
    expect(operationMessage(uninstall, { status: 'exited', exitCode: 0 }, [record('v1.0.0')])).toContain('与预期不一致')
  })

  it('reports failure with the remaining fact on a non-zero uninstall exit', () => {
    expect(operationMessage(uninstall, { status: 'exited', exitCode: 1 }, [record('v1.0.0')])).toBe(
      '命令执行失败，当前仍安装 v1.0.0'
    )
  })

  it('reports abnormality with the confirmed fact on a non-zero install exit', () => {
    expect(operationMessage(install, { status: 'exited', exitCode: 1 }, [record('v2.0.0')])).toBe(
      '命令报告异常；当前已确认安装 v2.0.0'
    )
  })

  it('reports abnormality when a non-zero uninstall exit left nothing installed', () => {
    expect(operationMessage(uninstall, { status: 'exited', exitCode: 1 }, [])).toBe('命令报告异常；当前未安装')
  })

  it('reports confirmation failure when exit 0 but the refresh failed', () => {
    expect(operationMessage(uninstall, { status: 'exited', exitCode: 0 }, undefined)).toContain('状态确认失败')
  })

  it('reports an unconfirmed failure when exit non-zero and the refresh failed', () => {
    expect(operationMessage(install, { status: 'exited', exitCode: 1 }, undefined)).toContain('无法确认当前安装状态')
  })

  it('reports pending confirmation for timeout', () => {
    expect(operationMessage(uninstall, { status: 'error', code: 'timeout' }, undefined)).toContain('操作结果待确认')
    expect(operationMessage(uninstall, { status: 'error', code: 'timeout' }, [])).toContain('操作结果待确认')
  })

  it('reports pending confirmation for cancellation', () => {
    expect(operationMessage(uninstall, { status: 'error', code: 'cancelled' }, undefined)).toContain('操作结果待确认')
  })

  it('does not infer apm is missing from a generic unavailable', () => {
    const message = operationMessage(uninstall, { status: 'error', code: 'unavailable' }, undefined)
    expect(message).toContain('操作不可用')
    expect(message).not.toMatch(/apm|安装工具缺失|启动安装工具/)
  })

  it('maps unauthorized and incompatible to the documented guidance', () => {
    expect(operationMessage(uninstall, { status: 'error', code: 'unauthorized' }, undefined)).toContain('未授权')
    expect(operationMessage(uninstall, { status: 'error', code: 'incompatible' }, undefined)).toContain('不支持该操作')
  })

  it('never claims a rollback and never interpolates raw error text', () => {
    const executions: Execution[] = [
      { status: 'exited', exitCode: 0 },
      { status: 'exited', exitCode: 1 },
      { status: 'exited', exitCode: 130 },
      { status: 'error', code: 'timeout' },
      { status: 'error', code: 'unavailable' },
      { status: 'error', code: 'unauthorized' },
      { status: 'error', code: 'incompatible' },
      { status: 'error', code: 'cancelled' },
    ]
    for (const execution of executions) {
      for (const actual of [undefined, [], [record('v1.0.0')], [record('v2.0.0')]]) {
        const message = operationMessage(install, execution, actual as APMPowerRecord[] | undefined)
        expect(message).not.toContain('回滚')
        expect(message).not.toContain('stderr')
        expect(message).not.toContain('SECRET')
      }
    }
  })
})
