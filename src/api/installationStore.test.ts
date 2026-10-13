import { describe, expect, it } from 'vitest'
import type { FeatureServiceApiV1, FeatureServiceRequestV1 } from '@bibit/feature-sdk'
import { getInstallationStore } from './installationStore'
import type { APMPowerRecord } from './apm'

function makeService(respond: (op: string, params: unknown, index: number) => unknown): {
  service: FeatureServiceApiV1<'store'>
  calls: FeatureServiceRequestV1<'store'>[]
} {
  const calls: FeatureServiceRequestV1<'store'>[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
      calls.push(input)
      return respond(input.operationId, input.params, calls.length - 1) as TResult
    },
  }
  return { service, calls }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const signal = () => new AbortController().signal

const record = (name: string, version: string): APMPowerRecord => ({
  agent: 'bibit',
  type: 'skill',
  name,
  version,
  description: '',
  tags: [],
})

const target = { agent: 'bibit', type: 'skill', name: 'demo' } as const
const demoKey = JSON.stringify(['bibit', 'skill', 'demo'])

const listResponse = (records: unknown[]) => ({
  scope: 'installed',
  status: 'data',
  listJson: JSON.stringify(records),
})

describe('getInstallationStore', () => {
  it('returns the same instance for the same service and isolates per service', () => {
    const a = makeService(() => listResponse([]))
    const b = makeService(() => listResponse([]))
    expect(getInstallationStore(a.service)).toBe(getInstallationStore(a.service))
    expect(getInstallationStore(a.service)).not.toBe(getInstallationStore(b.service))
  })

  it('keeps the snapshot reference stable until a publish', async () => {
    const { service } = makeService(() => listResponse([]))
    const store = getInstallationStore(service)
    const before = store.getSnapshot()
    expect(store.getSnapshot()).toBe(before)

    await store.refreshAgent('bibit', signal())
    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot().revision).toBeGreaterThan(before.revision)
  })

  it('keys items with JSON.stringify([agent, type, name])', async () => {
    const { service } = makeService((op) =>
      op === 'powers.inspect.v1' ? { listJson: '[]' } : listResponse([])
    )
    const store = getInstallationStore(service)
    await store.inspect({ ...target }, signal())
    expect(store.getSnapshot().items.has(demoKey)).toBe(true)
  })
})

describe('inspect', () => {
  it('marks checking during flight and ready on success', async () => {
    const gate = deferred<unknown>()
    const { service } = makeService((op) => (op === 'powers.inspect.v1' ? gate.promise : listResponse([])))
    const store = getInstallationStore(service)

    const pending = store.inspect({ ...target }, signal())
    expect(store.getSnapshot().items.get(demoKey)?.status).toBe('checking')

    gate.resolve({ listJson: '[]' })
    await pending
    expect(store.getSnapshot().items.get(demoKey)).toEqual({ status: 'ready', records: [] })
  })

  it('does not clear other powers of the same agent when one item is empty', async () => {
    const { service } = makeService((op) =>
      op === 'powers.inspect.v1' ? { listJson: '[]' } : listResponse([record('other', 'v1.0.0')])
    )
    const store = getInstallationStore(service)

    await store.refreshAgent('bibit', signal())
    await store.inspect({ ...target }, signal())

    const snapshot = store.getSnapshot()
    expect(snapshot.items.get(demoKey)).toEqual({ status: 'ready', records: [] })
    expect(snapshot.fullLists.get('bibit')?.some((r) => r.name === 'other')).toBe(true)
  })

  it('marks the full list expired when a single-item result disagrees', async () => {
    const { service } = makeService((op) =>
      op === 'powers.inspect.v1'
        ? { listJson: JSON.stringify([record('demo', 'v2.0.0')]) }
        : listResponse([record('other', 'v1.0.0')])
    )
    const store = getInstallationStore(service)

    await store.refreshAgent('bibit', signal())
    await store.inspect({ ...target }, signal())

    const snapshot = store.getSnapshot()
    expect(snapshot.items.get(demoKey)).toEqual({ status: 'ready', records: [record('demo', 'v2.0.0')] })
    expect(snapshot.fullLists.get('bibit')).toBeUndefined()
  })

  it('rejects a stale inspect that resolves after the agent epoch advanced', async () => {
    const slow = deferred<unknown>()
    const { service } = makeService((op, _params, index) => {
      if (op === 'powers.inspect.v1') return index === 0 ? slow.promise : { listJson: '[]' }
      if (op === 'powers.install.v1') return { status: 'exited', exitCode: 0 }
      return listResponse([])
    })
    const store = getInstallationStore(service)

    const pending = store.inspect({ ...target }, signal())
    // A mutation invalidates the agent epoch while the inspect is in flight.
    store.invalidateAgent('bibit')
    slow.resolve({ listJson: '[]' })
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })
})

describe('refreshAgent', () => {
  it('updates the full list and reconciles tracked items', async () => {
    const { service } = makeService((op) =>
      op === 'powers.inspect.v1'
        ? { listJson: '[]' }
        : listResponse([record('demo', 'v1.0.0'), record('other', 'v2.0.0')])
    )
    const store = getInstallationStore(service)

    await store.inspect({ ...target }, signal())
    const records = await store.refreshAgent('bibit', signal())

    expect(records).toHaveLength(2)
    const snapshot = store.getSnapshot()
    expect(snapshot.fullLists.get('bibit')).toHaveLength(2)
    expect(snapshot.items.get(demoKey)).toEqual({ status: 'ready', records: [record('demo', 'v1.0.0')] })
  })

  it('does not let a late full-list response overwrite a newer one after a mutation', async () => {
    const slow = deferred<unknown>()
    let listCalls = 0
    const { service } = makeService((op) => {
      if (op === 'powers.list.v1') {
        listCalls += 1
        if (listCalls === 1) return slow.promise
        return listResponse([record('demo', 'v1.0.0')])
      }
      if (op === 'powers.inspect.v1') return { listJson: '[]' }
      if (op === 'powers.install.v1') return { status: 'exited', exitCode: 0 }
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    const staleRefresh = store.refreshAgent('bibit', signal())
    await store.execute(
      { kind: 'install', input: { ...target, version: 'v1.0.0' } },
      signal()
    )

    slow.resolve(listResponse([]))
    await expect(staleRefresh).rejects.toMatchObject({ code: 'cancelled' })

    const full = store.getSnapshot().fullLists.get('bibit')
    expect(full?.some((r) => r.name === 'demo')).toBe(true)
  })
})

describe('execute', () => {
  const installIntent = {
    kind: 'install' as const,
    input: { agent: 'bibit', type: 'skill' as const, name: 'demo', version: 'v1.0.0' },
  }
  const uninstallIntent = {
    kind: 'uninstall' as const,
    input: { agent: 'bibit', type: 'skill' as const, name: 'demo' },
  }

  it('runs install with the version and reconciles the full list', async () => {
    const { service, calls } = makeService((op) => {
      if (op === 'powers.inspect.v1') return { listJson: '[]' }
      if (op === 'powers.install.v1') return { status: 'exited', exitCode: 0 }
      if (op === 'powers.list.v1') return listResponse([record('demo', 'v1.0.0')])
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    await store.execute(installIntent, signal())

    const installCall = calls.find((c) => c.operationId === 'powers.install.v1')
    expect(installCall?.params).toEqual({
      agent: 'bibit',
      type: 'skill',
      name: 'demo',
      version: 'v1.0.0',
    })
    expect(installCall?.timeoutMs).toBe(120_000)
    expect(store.getSnapshot().fullLists.get('bibit')?.some((r) => r.name === 'demo')).toBe(true)
    expect(store.getSnapshot().notices.get(demoKey)).toEqual({ text: 'Installation complete.' })
  })

  it('runs uninstall without a version', async () => {
    const { service, calls } = makeService((op) => {
      if (op === 'powers.uninstall.v1') return { status: 'exited', exitCode: 0 }
      if (op === 'powers.list.v1') return listResponse([])
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    await store.execute(uninstallIntent, signal())

    const call = calls.find((c) => c.operationId === 'powers.uninstall.v1')
    expect(call?.params).toEqual({ agent: 'bibit', type: 'skill', name: 'demo' })
    expect(store.getSnapshot().notices.get(demoKey)).toEqual({ text: 'Uninstall complete.' })
    // A confirmed removal is what lets the page close the details dialog.
    expect(store.getSnapshot().confirmedRemovals.has(demoKey)).toBe(true)
  })

  it('does not mark an install as a confirmed removal', async () => {
    const { service } = makeService((op) => {
      if (op === 'powers.inspect.v1') return { listJson: '[]' }
      if (op === 'powers.install.v1') return { status: 'exited', exitCode: 0 }
      if (op === 'powers.list.v1') return listResponse([record('demo', 'v1.0.0')])
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    await store.execute(installIntent, signal())

    expect(store.getSnapshot().confirmedRemovals.has(demoKey)).toBe(false)
  })

  it('does not mark a failed uninstall that left the Power installed', async () => {
    const { service } = makeService((op) => {
      if (op === 'powers.uninstall.v1') return { status: 'exited', exitCode: 1 }
      if (op === 'powers.list.v1') return listResponse([record('demo', 'v1.0.0')])
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    await store.execute(uninstallIntent, signal())

    const snapshot = store.getSnapshot()
    expect(snapshot.notices.get(demoKey)).toEqual({
      text: 'The command failed; version {version} is still installed.',
      values: { version: 'v1.0.0' },
    })
    expect(snapshot.confirmedRemovals.has(demoKey)).toBe(false)
  })

  it('clears a confirmed removal when the next mutation for that Power starts', async () => {
    let uninstalled = false
    let staleVerdictSeen = false
    const { service } = makeService((op) => {
      if (op === 'powers.uninstall.v1') {
        uninstalled = true
        return { status: 'exited', exitCode: 0 }
      }
      if (op === 'powers.install.v1') {
        // Sampled mid-write: the stale verdict must already be gone, so the page
        // cannot close a dialog on a result that no longer describes reality.
        staleVerdictSeen = store.getSnapshot().confirmedRemovals.has(demoKey)
        uninstalled = false
        return { status: 'exited', exitCode: 0 }
      }
      if (op === 'powers.inspect.v1') return { listJson: '[]' }
      if (op === 'powers.list.v1') {
        return listResponse(uninstalled ? [] : [record('demo', 'v1.0.0')])
      }
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    await store.execute(uninstallIntent, signal())
    expect(store.getSnapshot().confirmedRemovals.has(demoKey)).toBe(true)

    await store.execute(installIntent, signal())

    expect(staleVerdictSeen).toBe(false)
    expect(store.getSnapshot().confirmedRemovals.has(demoKey)).toBe(false)
  })

  it('short-circuits install when the target version is already installed', async () => {
    let installCalls = 0
    const { service } = makeService((op) => {
      if (op === 'powers.inspect.v1') return { listJson: JSON.stringify([record('demo', 'v1.0.0')]) }
      if (op === 'powers.install.v1') {
        installCalls += 1
        return { status: 'exited', exitCode: 0 }
      }
      if (op === 'powers.list.v1') return listResponse([record('demo', 'v1.0.0')])
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    await store.execute(installIntent, signal())

    expect(installCalls).toBe(0)
    expect(store.getSnapshot().notices.get(demoKey)?.text).toContain('already installed')
  })

  it('rejects a second concurrent execute and runs only one mutation', async () => {
    const gate = deferred<unknown>()
    let installCalls = 0
    const { service } = makeService((op) => {
      if (op === 'powers.inspect.v1') return { listJson: '[]' }
      if (op === 'powers.install.v1') {
        installCalls += 1
        return gate.promise
      }
      if (op === 'powers.list.v1') return listResponse([record('demo', 'v1.0.0')])
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    const first = store.execute(installIntent, signal())
    await expect(store.execute(installIntent, signal())).rejects.toThrow()
    gate.resolve({ status: 'exited', exitCode: 0 })
    await first

    expect(installCalls).toBe(1)
  })

  it('keeps the target in error but releases the lock when reconcile fails', async () => {
    const { service } = makeService((op) => {
      if (op === 'powers.inspect.v1') return { listJson: '[]' }
      if (op === 'powers.install.v1') return { status: 'exited', exitCode: 0 }
      if (op === 'powers.list.v1') {
        throw { version: 1, code: 'unavailable', message: 'down', retryable: true }
      }
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    await store.execute(installIntent, signal())

    const snapshot = store.getSnapshot()
    expect(snapshot.items.get(demoKey)?.status).toBe('error')
    expect(snapshot.active).toBeUndefined()
    expect(snapshot.notices.get(demoKey)?.text).toContain('could not be confirmed')
  })

  it('skips the reconcile network read when the page signal is aborted', async () => {
    const controller = new AbortController()
    let listCalls = 0
    let installCalls = 0
    const { service } = makeService((op) => {
      if (op === 'powers.inspect.v1') return { listJson: '[]' }
      if (op === 'powers.install.v1') {
        installCalls += 1
        controller.abort()
        return { status: 'exited', exitCode: 0 }
      }
      if (op === 'powers.list.v1') {
        listCalls += 1
        return listResponse([])
      }
      throw new Error(`unexpected op ${op}`)
    })
    const store = getInstallationStore(service)

    await store.execute(installIntent, controller.signal)

    expect(installCalls).toBe(1)
    expect(listCalls).toBe(0)
    expect(store.getSnapshot().active).toBeUndefined()
  })
})

describe('upgrade', () => {
  const upgradeOk = (items: unknown[] = []) => ({
    status: 'exited',
    exitCode: 0,
    items,
    reason: '',
  })

  it('runs the operation for the chosen scope and refreshes the affected Agents', async () => {
    const { service, calls } = makeService((op) => {
      if (op === 'powers.upgrade.v1') return upgradeOk()
      return listResponse([record('demo', 'v2.0.0')])
    })
    const store = getInstallationStore(service)

    const outcome = await store.upgrade('bibit', signal())

    expect(outcome).toEqual({ status: 'ok', result: upgradeOk() })
    expect(calls[0].operationId).toBe('powers.upgrade.v1')
    expect(calls[0].params).toEqual({ agent: 'bibit' })
    // The installed list must be re-read, or the page would show pre-upgrade versions.
    const listCalls = calls.filter((call) => call.operationId === 'powers.list.v1')
    expect(listCalls).toHaveLength(1)
    expect(listCalls[0].params).toEqual({ scope: 'installed', agent: 'bibit' })
  })

  it('re-reads every installed Agent after an all-scope run', async () => {
    const { service, calls } = makeService((op) =>
      op === 'powers.upgrade.v1' ? upgradeOk() : listResponse([])
    )
    const store = getInstallationStore(service)

    await store.upgrade('all', signal())

    const agents = calls
      .filter((call) => call.operationId === 'powers.list.v1')
      .map((call) => (call.params as { agent: string }).agent)
      .sort()
    expect(agents).toEqual(['bibit', 'claude-code', 'codex', 'hermes-agent'])
  })

  it('publishes an active marker for the whole run and clears it after', async () => {
    const pending = deferred<unknown>()
    const { service } = makeService((op) => (op === 'powers.upgrade.v1' ? pending.promise : listResponse([])))
    const store = getInstallationStore(service)

    const running = store.upgrade('bibit', signal())
    // One microtask is enough for the run to reach the awaited request.
    await Promise.resolve()
    const active = store.getSnapshot().active
    expect(active?.kind).toBe('upgrade')

    pending.resolve(upgradeOk())
    await running
    expect(store.getSnapshot().active).toBeUndefined()
  })

  it('refuses to start while a Power mutation is in flight', async () => {
    // The provider is one serial process, so two writes at once are not possible;
    // the store must reject the second rather than queue it.
    const pending = deferred<unknown>()
    const { service, calls } = makeService((op) => {
      if (op === 'powers.inspect.v1') return { listJson: '[]' }
      if (op === 'powers.install.v1') return pending.promise
      return listResponse([])
    })
    const store = getInstallationStore(service)

    const install = store.execute(
      { kind: 'install', input: { ...target, version: 'v1.0.0' } },
      signal()
    )
    await Promise.resolve()

    await expect(store.upgrade('bibit', signal())).resolves.toEqual({ status: 'busy' })
    expect(calls.some((call) => call.operationId === 'powers.upgrade.v1')).toBe(false)

    pending.resolve({ status: 'exited', exitCode: 0 })
    await install
  })

  it('refuses a second upgrade while one is running', async () => {
    const pending = deferred<unknown>()
    const { service, calls } = makeService((op) => (op === 'powers.upgrade.v1' ? pending.promise : listResponse([])))
    const store = getInstallationStore(service)

    const first = store.upgrade('bibit', signal())
    await Promise.resolve()

    await expect(store.upgrade('codex', signal())).resolves.toEqual({ status: 'busy' })
    expect(calls.filter((call) => call.operationId === 'powers.upgrade.v1')).toHaveLength(1)

    pending.resolve(upgradeOk())
    await first
  })

  it('reports a timeout and still re-reads the installed list', async () => {
    // A timeout does not mean nothing was upgraded: apm may have changed entries
    // before the Host cut the request, so the list must be re-read either way.
    const { service, calls } = makeService((op) => {
      if (op === 'powers.upgrade.v1') {
        throw Object.assign(new Error('timed out'), { version: 1, code: 'timeout', retryable: true })
      }
      return listResponse([record('demo', 'v2.0.0')])
    })
    const store = getInstallationStore(service)

    await expect(store.upgrade('bibit', signal())).resolves.toEqual({ status: 'timeout' })
    expect(calls.filter((call) => call.operationId === 'powers.list.v1')).toHaveLength(1)
    expect(store.getSnapshot().active).toBeUndefined()
  })

  it('reports any other platform failure by code', async () => {
    const { service } = makeService((op) => {
      if (op === 'powers.upgrade.v1') {
        throw Object.assign(new Error('no store'), { version: 1, code: 'unavailable', retryable: false })
      }
      return listResponse([])
    })
    const store = getInstallationStore(service)

    await expect(store.upgrade('bibit', signal())).resolves.toEqual({
      status: 'failed',
      code: 'unavailable',
    })
  })

  it('releases the lock even when the refresh throws', async () => {
    // Otherwise one failed refresh would wedge every later write for the session:
    // `internals.locked` is the guard that keeps two writes apart, and it is
    // cleared in a `finally` for exactly this reason.
    const { service } = makeService((op) => {
      if (op === 'powers.upgrade.v1') return upgradeOk()
      throw new Error('list failed')
    })
    const store = getInstallationStore(service)

    await store.upgrade('bibit', signal())

    expect(store.getSnapshot().active).toBeUndefined()
    // The same store accepts the next run rather than answering `busy` forever.
    await expect(store.upgrade('bibit', signal())).resolves.toMatchObject({ status: 'ok' })
  })
})
