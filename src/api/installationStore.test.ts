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
