import type { FeatureServiceApiV1 } from '@bibit/feature-sdk'
import type { TranslatableText } from '../agentHubI18n'
import { POWERS_LIST_OPERATION_ID, parsePowersWireResult } from './contracts'
import { parseApmInstalledList, type APMPowerRecord } from './apm'
import {
  inspectPower,
  mutatePower,
  parsePowerTarget,
  type MutationIntent,
  type PowerTarget,
} from './powerOperations'
import { operationMessage, isRemovalConfirmed, type Execution } from './operationMessages'

export type InstallationState =
  | { status: 'unknown' | 'checking' }
  | { status: 'ready'; records: APMPowerRecord[] }
  | { status: 'error'; message: TranslatableText }

export type ActiveMutation = { intent: MutationIntent; phase: 'preflight' | 'running' | 'reconciling' }

export type InstallationSnapshot = {
  revision: number
  items: ReadonlyMap<string, InstallationState>
  fullLists: ReadonlyMap<string, readonly APMPowerRecord[]>
  active?: ActiveMutation
  notices: ReadonlyMap<string, TranslatableText>
  /**
   * Item keys whose last mutation was a confirmed removal. The page reads this to
   * close the details dialog of a Power that is no longer installed, instead of
   * staying on it. Cleared for a key when that key's next mutation starts.
   */
  confirmedRemovals: ReadonlySet<string>
}

export interface InstallationStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): InstallationSnapshot
  inspect(target: PowerTarget, signal: AbortSignal): Promise<APMPowerRecord[]>
  refreshAgent(agent: string, signal: AbortSignal): Promise<APMPowerRecord[]>
  execute(intent: MutationIntent, signal: AbortSignal): Promise<void>
  invalidateAgent(agent: string): void
}

const ALREADY_INSTALLED_MESSAGE: TranslatableText = {
  text: 'This version is already installed; uninstall it first.',
}
const REFRESH_FAILED_MESSAGE: TranslatableText = {
  text: 'Refresh failed; the installed state could not be confirmed.',
}

interface Internals {
  service: FeatureServiceApiV1<'store'>
  revision: number
  items: Map<string, InstallationState>
  targets: Map<string, PowerTarget>
  fullLists: Map<string, readonly APMPowerRecord[]>
  epochs: Map<string, number>
  itemSeqs: Map<string, number>
  fullSeqs: Map<string, number>
  active?: ActiveMutation
  notices: Map<string, TranslatableText>
  confirmedRemovals: Set<string>
  listeners: Set<() => void>
  locked: boolean
  snapshot?: InstallationSnapshot
}

function itemKey(target: PowerTarget): string {
  return JSON.stringify([target.agent, target.type, target.name])
}

function recordIdentity(record: APMPowerRecord): string {
  return `${record.type}\u0000${record.name}\u0000${record.version}`
}

function isCancelledError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'cancelled'
}

function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return 'unknown'
}

function cancelled(): never {
  throw Object.assign(new Error('Request was cancelled.'), { version: 1, code: 'cancelled', retryable: false })
}

function busy(): never {
  throw new Error('A mutation is already in progress.')
}

function isInstalledAtVersion(records: readonly APMPowerRecord[], input: { agent: string; type: string; name: string; version: string }): boolean {
  return records.some(
    (record) =>
      record.agent === input.agent &&
      record.type === input.type &&
      record.name === input.name &&
      record.version === input.version
  )
}

/**
 * Reads the raw installed list for one agent over `powers.list.v1`. This is the
 * single internal raw-read shared by the store's full-list refresh.
 */
async function readInstalledRecords(
  service: FeatureServiceApiV1<'store'>,
  agent: string,
  signal: AbortSignal
): Promise<APMPowerRecord[]> {
  const wireResult = parsePowersWireResult(
    await service.request<Record<string, unknown>>({
      serviceId: 'store',
      operationId: POWERS_LIST_OPERATION_ID,
      params: { scope: 'installed', agent },
      timeoutMs: 30_000,
      signal,
    })
  )
  if (wireResult.scope !== 'installed' || wireResult.status !== 'data') {
    throw Object.assign(new Error('Provider returned an unexpected installed result.'), {
      version: 1,
      code: 'incompatible',
      retryable: false,
    })
  }
  return parseApmInstalledList(JSON.parse(wireResult.listJson))
}

const stores = new WeakMap<FeatureServiceApiV1<'store'>, InstallationStore>()

export function getInstallationStore(service: FeatureServiceApiV1<'store'>): InstallationStore {
  let store = stores.get(service)
  if (!store) {
    store = createInstallationStore(service)
    stores.set(service, store)
  }
  return store
}

function createInstallationStore(service: FeatureServiceApiV1<'store'>): InstallationStore {
  const internals: Internals = {
    service,
    revision: 0,
    items: new Map(),
    targets: new Map(),
    fullLists: new Map(),
    epochs: new Map(),
    itemSeqs: new Map(),
    fullSeqs: new Map(),
    notices: new Map(),
    confirmedRemovals: new Set(),
    listeners: new Set(),
    locked: false,
  }

  function epochFor(agent: string): number {
    return internals.epochs.get(agent) ?? 0
  }

  function buildSnapshot(): InstallationSnapshot {
    return {
      revision: internals.revision,
      items: new Map(internals.items),
      fullLists: new Map(internals.fullLists),
      ...(internals.active !== undefined ? { active: internals.active } : {}),
      notices: new Map(internals.notices),
      confirmedRemovals: new Set(internals.confirmedRemovals),
    }
  }

  function publish(): void {
    internals.revision += 1
    internals.snapshot = buildSnapshot()
    for (const listener of [...internals.listeners]) {
      listener()
    }
  }

  function setItem(key: string, target: PowerTarget, state: InstallationState): void {
    internals.items.set(key, state)
    internals.targets.set(key, target)
  }

  function rejectIfStale(signal: AbortSignal, agent: string, epoch: number, key: string, seq: number): void {
    if (signal.aborted || epochFor(agent) !== epoch || internals.itemSeqs.get(key) !== seq) {
      cancelled()
    }
  }

  function markFullListExpired(agent: string, records: readonly APMPowerRecord[], target: PowerTarget): void {
    const full = internals.fullLists.get(agent)
    if (full === undefined) return
    const inItem = new Set(records.map(recordIdentity))
    const inFull = new Set(
      full.filter((record) => record.type === target.type && record.name === target.name).map(recordIdentity)
    )
    if (inItem.size !== inFull.size) {
      internals.fullLists.delete(agent)
      return
    }
    for (const identity of inItem) {
      if (!inFull.has(identity)) {
        internals.fullLists.delete(agent)
        return
      }
    }
  }

  async function inspect(target: PowerTarget, signal: AbortSignal): Promise<APMPowerRecord[]> {
    const parsed = parsePowerTarget(target)
    const key = itemKey(parsed)
    const agent = parsed.agent
    const epoch = epochFor(agent)
    const seq = (internals.itemSeqs.get(key) ?? 0) + 1
    internals.itemSeqs.set(key, seq)
    setItem(key, parsed, { status: 'checking' })
    publish()
    let records: APMPowerRecord[]
    try {
      records = await inspectPower(internals.service, parsed, signal)
    } catch (err) {
      if (!isCancelledError(err) && !signal.aborted) {
        setItem(key, parsed, { status: 'error', message: REFRESH_FAILED_MESSAGE })
        publish()
      }
      throw err
    }
    rejectIfStale(signal, agent, epoch, key, seq)
    setItem(key, parsed, { status: 'ready', records })
    markFullListExpired(agent, records, parsed)
    publish()
    return records
  }

  async function refreshAgent(agent: string, signal: AbortSignal): Promise<APMPowerRecord[]> {
    const epoch = epochFor(agent)
    const seq = (internals.fullSeqs.get(agent) ?? 0) + 1
    internals.fullSeqs.set(agent, seq)
    const records = await readInstalledRecords(internals.service, agent, signal)
    if (signal.aborted || epochFor(agent) !== epoch || internals.fullSeqs.get(agent) !== seq) {
      cancelled()
    }
    internals.fullLists.set(agent, records)
    for (const [key, target] of internals.targets) {
      if (target.agent !== agent) continue
      const matching = records.filter(
        (record) => record.agent === agent && record.type === target.type && record.name === target.name
      )
      setItem(key, target, { status: 'ready', records: matching })
    }
    publish()
    return records
  }

  async function reconcile(
    intent: MutationIntent,
    key: string,
    agent: string,
    execution: Execution,
    signal: AbortSignal
  ): Promise<void> {
    internals.active = { intent, phase: 'reconciling' }
    invalidateAgent(agent)
    publish()
    let actual: APMPowerRecord[] | undefined
    if (!signal.aborted) {
      const controller = new AbortController()
      try {
        actual = await refreshAgent(agent, controller.signal)
      } catch {
        const target = internals.targets.get(key)
        if (target) {
          setItem(key, target, { status: 'error', message: REFRESH_FAILED_MESSAGE })
        }
        publish()
      }
    }
    internals.notices.set(key, operationMessage(intent, execution, actual))
    // The page closes the dialog of a Power that is confirmed gone. The verdict
    // comes from the same evidence that produced the message, so the copy and the
    // close decision can never disagree.
    if (isRemovalConfirmed(intent, execution, actual)) {
      internals.confirmedRemovals.add(key)
    }
    internals.active = undefined
    publish()
  }

  async function execute(intent: MutationIntent, signal: AbortSignal): Promise<void> {
    if (internals.locked) {
      busy()
    }
    internals.locked = true
    const input = intent.input
    const target: PowerTarget = { agent: input.agent, type: input.type, name: input.name }
    const agent = target.agent
    const key = itemKey(target)
    try {
      // A fresh mutation supersedes the previous verdict for this Power: until it
      // reconciles, nothing is known about whether it is gone.
      internals.confirmedRemovals.delete(key)
      invalidateAgent(agent)
      let execution: Execution = { status: 'error', code: 'unknown' }
      let shortCircuit: TranslatableText | undefined

      if (intent.kind === 'install') {
        internals.active = { intent, phase: 'preflight' }
        publish()
        let actual: APMPowerRecord[]
        try {
          actual = await inspect(target, signal)
        } catch (err) {
          await reconcile(intent, key, agent, { status: 'error', code: errorCode(err) }, signal)
          return
        }
        if (isInstalledAtVersion(actual, intent.input)) {
          shortCircuit = ALREADY_INSTALLED_MESSAGE
        }
      }

      if (shortCircuit === undefined) {
        internals.active = { intent, phase: 'running' }
        publish()
        try {
          execution = await mutatePower(internals.service, intent, signal)
        } catch (err) {
          execution = { status: 'error', code: errorCode(err) }
        }
      }

      if (shortCircuit !== undefined) {
        internals.notices.set(key, shortCircuit)
        internals.active = undefined
        publish()
        return
      }
      await reconcile(intent, key, agent, execution, signal)
    } finally {
      internals.locked = false
    }
  }

  function invalidateAgent(agent: string): void {
    internals.epochs.set(agent, epochFor(agent) + 1)
    internals.fullLists.delete(agent)
    publish()
  }

  return {
    subscribe(listener: () => void): () => void {
      internals.listeners.add(listener)
      return () => {
        internals.listeners.delete(listener)
      }
    },
    getSnapshot(): InstallationSnapshot {
      if (internals.snapshot === undefined) {
        internals.snapshot = buildSnapshot()
      }
      return internals.snapshot
    },
    inspect,
    refreshAgent,
    execute,
    invalidateAgent,
  }
}
