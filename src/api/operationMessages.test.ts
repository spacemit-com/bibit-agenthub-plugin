import { describe, expect, it } from 'vitest'
import {
  operationMessage,
  isRemovalConfirmed,
  type Execution,
} from './operationMessages'
import type { TranslatableText } from '../agentHubI18n'
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

/** Messages carry English source text plus the values their slots need. */
const text = (message: TranslatableText) => message.text

describe('operationMessage', () => {
  it('reports install success when exit 0 and the target version is installed', () => {
    expect(operationMessage(install, { status: 'exited', exitCode: 0 }, [record('v2.0.0')])).toEqual({
      text: 'Installation complete.',
    })
  })

  it('reports uninstall success when exit 0 and the target is gone', () => {
    expect(operationMessage(uninstall, { status: 'exited', exitCode: 0 }, [])).toEqual({
      text: 'Uninstall complete.',
    })
  })

  it('reports state mismatch when exit 0 but the install target version is absent', () => {
    expect(text(operationMessage(install, { status: 'exited', exitCode: 0 }, [record('v1.0.0')]))).toContain(
      'does not match the expectation'
    )
  })

  it('reports state mismatch when exit 0 but an uninstalled target is still installed', () => {
    expect(text(operationMessage(uninstall, { status: 'exited', exitCode: 0 }, [record('v1.0.0')]))).toContain(
      'does not match the expectation'
    )
  })

  it('reports failure with the remaining fact on a non-zero uninstall exit', () => {
    expect(operationMessage(uninstall, { status: 'exited', exitCode: 1 }, [record('v1.0.0')])).toEqual({
      text: 'The command failed; version {version} is still installed.',
      values: { version: 'v1.0.0' },
    })
  })

  it('reports abnormality with the confirmed fact on a non-zero install exit', () => {
    expect(operationMessage(install, { status: 'exited', exitCode: 1 }, [record('v2.0.0')])).toEqual({
      text: 'The command reported an error; version {version} is confirmed installed.',
      values: { version: 'v2.0.0' },
    })
  })

  it('reports abnormality when a non-zero uninstall exit left nothing installed', () => {
    expect(operationMessage(uninstall, { status: 'exited', exitCode: 1 }, [])).toEqual({
      text: 'The command reported an error; nothing is installed.',
    })
  })

  it('reports confirmation failure when exit 0 but the refresh failed', () => {
    expect(text(operationMessage(uninstall, { status: 'exited', exitCode: 0 }, undefined))).toContain(
      'installed state could not be confirmed'
    )
  })

  it('reports an unconfirmed failure when exit non-zero and the refresh failed', () => {
    expect(text(operationMessage(install, { status: 'exited', exitCode: 1 }, undefined))).toContain(
      'could not be confirmed'
    )
  })

  it('reports pending confirmation for timeout', () => {
    expect(text(operationMessage(uninstall, { status: 'error', code: 'timeout' }, undefined))).toContain(
      'needs confirmation'
    )
    expect(text(operationMessage(uninstall, { status: 'error', code: 'timeout' }, []))).toContain(
      'needs confirmation'
    )
  })

  it('reports pending confirmation for cancellation', () => {
    expect(text(operationMessage(uninstall, { status: 'error', code: 'cancelled' }, undefined))).toContain(
      'needs confirmation'
    )
  })

  it('does not infer apm is missing from a generic unavailable', () => {
    const message = text(operationMessage(uninstall, { status: 'error', code: 'unavailable' }, undefined))
    expect(message).toContain('unavailable')
    expect(message).not.toMatch(/apm|installer is missing|installer could not be started/)
  })

  it('maps unauthorized and incompatible to the documented guidance', () => {
    expect(text(operationMessage(uninstall, { status: 'error', code: 'unauthorized' }, undefined))).toContain(
      'not authorized'
    )
    expect(text(operationMessage(uninstall, { status: 'error', code: 'incompatible' }, undefined))).toContain(
      'does not support that operation'
    )
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
        const message = text(operationMessage(install, execution, actual as APMPowerRecord[] | undefined))
        expect(message).not.toContain('rollback')
        expect(message).not.toContain('stderr')
        expect(message).not.toContain('SECRET')
      }
    }
  })
})

describe('isRemovalConfirmed', () => {
  it('confirms an uninstall whose reconcile already lacks the target', () => {
    expect(isRemovalConfirmed(uninstall, { status: 'exited', exitCode: 0 }, [])).toBe(true)
    // Records for other Powers do not affect this target's verdict.
    expect(
      isRemovalConfirmed(uninstall, { status: 'exited', exitCode: 0 }, [
        { ...record('v1.0.0'), name: 'other-skill' },
      ])
    ).toBe(true)
  })

  it('confirms an uninstall that reported an error but is already gone', () => {
    // apm errored, yet the reconciled list proves the Power is uninstalled. The
    // dialog must not stay open on a Power that no longer exists.
    expect(isRemovalConfirmed(uninstall, { status: 'exited', exitCode: 1 }, [])).toBe(true)
  })

  it('does not confirm while the Power is still installed', () => {
    expect(isRemovalConfirmed(uninstall, { status: 'exited', exitCode: 1 }, [record('v1.0.0')])).toBe(
      false
    )
    // A successful exit whose reconcile still shows the record is a mismatch the
    // user has to see, not a removal.
    expect(isRemovalConfirmed(uninstall, { status: 'exited', exitCode: 0 }, [record('v1.0.0')])).toBe(
      false
    )
  })

  it('does not confirm when the reconcile never ran', () => {
    for (const execution of [
      { status: 'error', code: 'timeout' },
      { status: 'error', code: 'unavailable' },
      { status: 'error', code: 'cancelled' },
    ] satisfies Execution[]) {
      expect(isRemovalConfirmed(uninstall, execution, undefined)).toBe(false)
      expect(isRemovalConfirmed(uninstall, execution, [])).toBe(false)
    }
    expect(isRemovalConfirmed(uninstall, { status: 'exited', exitCode: 0 }, undefined)).toBe(false)
  })

  it('never confirms an install, which leaves the Power on disk', () => {
    for (const actual of [undefined, [], [record('v2.0.0')]]) {
      expect(isRemovalConfirmed(install, { status: 'exited', exitCode: 0 }, actual)).toBe(false)
    }
  })

  it('agrees with the message it ships alongside', () => {
    // The close decision and the copy come from the same evidence; lock the pairs
    // that matter so a future edit cannot desynchronize them.
    const cases: [Execution, APMPowerRecord[] | undefined][] = [
      [{ status: 'exited', exitCode: 0 }, []],
      [{ status: 'exited', exitCode: 1 }, []],
      [{ status: 'exited', exitCode: 1 }, [record('v1.0.0')]],
      [{ status: 'error', code: 'unavailable' }, undefined],
    ]
    for (const [execution, actual] of cases) {
      const message = text(operationMessage(uninstall, execution, actual))
      const gone = message === 'Uninstall complete.' || message === 'The command reported an error; nothing is installed.'
      expect(isRemovalConfirmed(uninstall, execution, actual)).toBe(gone)
    }
  })
})
