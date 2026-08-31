import { useEffect, useRef, useState } from 'react'
import { useFeatureCapability, type FeaturePageProps } from '@bibit/feature-sdk'
import type { ServiceJobSnapshotV1 } from '@bibit/feature-contracts'
import {
  FeatureEmptyState,
  FeatureErrorState,
  Skeleton,
  getFeatureIcon,
} from '@bibit/feature-ui'
import './agentHub.css'
import {
  parseAgentDownloadResult,
  parseAgentSummaries,
  parseAgentUploadResult,
  type AgentSummary,
} from './storeContracts'

const StoreIcon = getFeatureIcon('store')
const terminalStates = new Set(['succeeded', 'failed', 'cancelled'])
type TransferAction = { kind: 'upload' } | { kind: 'download'; agent: AgentSummary }

const idempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  `agenthub-${Date.now()}-${Math.random().toString(16).slice(2)}`

export function AgentHubPage(_: FeaturePageProps) {
  const store = useFeatureCapability('service:store')
  const files = useFeatureCapability('file:transfer')
  const jobs = useFeatureCapability('job:manage')
  const [agents, setAgents] = useState<readonly AgentSummary[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [job, setJob] = useState<ServiceJobSnapshotV1>()
  const [lastAction, setLastAction] = useState<TransferAction>()
  const [transferError, setTransferError] = useState('')
  const [cancelPending, setCancelPending] = useState(false)
  const [providerState, setProviderState] = useState<
    'checking' | 'available' | 'provider_v2_unavailable' | 'provider_unavailable'
  >('checking')
  const handledTerminal = useRef('')

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setCatalogError('')
    if (!store) {
      setCatalogError('Store capability is not available.')
      setLoading(false)
      return () => { active = false }
    }
    void store.request<unknown>({
      serviceId: 'store',
      operationId: 'agents.list.v1',
      params: {},
      signal: controller.signal,
    }).then(parseAgentSummaries).then((items) => {
      if (active) setAgents(items)
    }).catch((reason) => {
      if (active) setCatalogError(String(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [store, reload])

  useEffect(() => {
    let active = true
    if (!files || !jobs) {
      setProviderState('provider_unavailable')
      return () => { active = false }
    }
    void Promise.all([jobs.availability('store'), jobs.list('store')])
      .then(([availability, history]) => {
        if (!active) return
        setProviderState(
          availability.available
            ? 'available'
            : availability.reason ?? 'provider_unavailable'
        )
        const restored =
          history.find((item) => !terminalStates.has(item.status)) ?? history.at(-1)
        if (restored) setJob(restored)
      })
      .catch(() => {
        if (active) setProviderState('provider_unavailable')
      })
    return () => { active = false }
  }, [files, jobs])

  const jobId = job?.jobId
  const lastSequence = job?.lastSequence ?? 0
  useEffect(() => {
    if (!jobs || !jobId || terminalStates.has(job?.status ?? '')) return
    return jobs.subscribe(
      { version: 1, jobId, afterSequence: lastSequence },
      ({ snapshot }) => setJob(snapshot)
    )
  }, [job?.status, jobId, jobs, lastSequence])

  useEffect(() => {
    if (!job || !terminalStates.has(job.status) || handledTerminal.current === job.jobId) return
    handledTerminal.current = job.jobId
    setCancelPending(false)
    if (job.status !== 'succeeded') return
    try {
      if (job.operationId === 'agents.upload.v1') {
        parseAgentUploadResult(job.result)
        setReload((value) => value + 1)
      } else {
        parseAgentDownloadResult(job.result)
      }
    } catch (reason) {
      setTransferError(String(reason))
    }
  }, [job])

  const busy = Boolean(job && !terminalStates.has(job.status))
  const unavailableReason = !files || !jobs
    ? 'Bibit has not granted file transfer and job capabilities.'
    : providerState === 'provider_v2_unavailable'
      ? 'The current Store Provider does not support asynchronous transfer v2.'
      : providerState === 'provider_unavailable'
        ? 'The Store Provider is unavailable.'
        : providerState === 'checking'
          ? 'Checking Store Provider transfer support…'
          : ''

  const startTransfer = async (action: TransferAction) => {
    if (!files || !jobs || busy || providerState !== 'available') return
    setLastAction(action)
    setTransferError('')
    const upload = action.kind === 'upload'
    const operationId = upload ? 'agents.upload.v1' : 'agents.download.v1'
    try {
      const grant = await files.select({
        version: 1,
        serviceId: 'store',
        operationId,
        direction: upload ? 'upload' : 'download',
        suggestedName: upload ? undefined : `${action.agent.name}.demo-agent`,
      })
      if (!grant) return
      const result = await jobs.start({
        version: 1,
        serviceId: 'store',
        operationId,
        idempotencyKey: idempotencyKey(),
        grantId: grant.grantId,
        input: upload
          ? { displayName: grant.displayName }
          : { agentId: action.agent.id },
      })
      handledTerminal.current = ''
      setJob(result.job)
    } catch (reason) {
      setTransferError(String(reason))
    }
  }

  const cancel = async () => {
    if (!jobs || !job || cancelPending || terminalStates.has(job.status)) return
    setCancelPending(true)
    try {
      setJob(await jobs.cancel({ version: 1, jobId: job.jobId }))
    } catch (reason) {
      setTransferError(String(reason))
      setCancelPending(false)
    }
  }

  const progress = job?.progress
  const resultText = job?.status === 'succeeded'
    ? job.operationId === 'agents.upload.v1'
      ? 'Upload completed. The Agent catalog is refreshing.'
      : 'Download completed and was published to the selected destination.'
    : undefined

  return (
    <main className="agent-hub">
      <div className="agent-hub__content">
        <header className="agent-hub__header">
          <div className="agent-hub__identity">
            <span className="agent-hub__icon"><StoreIcon /></span>
            <div>
              <p className="agent-hub__eyebrow">Agent catalog</p>
              <h1>Agent Hub</h1>
              <p className="agent-hub__description">Browse, upload, and download Agent packages.</p>
            </div>
          </div>
          <div className="agent-hub__header-actions">
            {!loading && !catalogError && (
              <span className="agent-hub__count">{agents.length} available</span>
            )}
            <button
              type="button"
              className="agent-hub__primary-action"
              disabled={busy || Boolean(unavailableReason)}
              onClick={() => void startTransfer({ kind: 'upload' })}
            >
              Upload Agent
            </button>
          </div>
        </header>

        {unavailableReason && (
          <p className="agent-hub__notice" role="status">{unavailableReason}</p>
        )}

        {job && (
          <section className="agent-hub__job" aria-label="Agent transfer">
            <div aria-live="polite">
              <strong>{job.operationId === 'agents.upload.v1' ? 'Uploading Agent' : 'Downloading Agent'}</strong>
              <span>{job.status.replaceAll('_', ' ')}</span>
            </div>
            {progress?.totalBytes !== undefined ? (
              <progress aria-label="Transfer progress" max={progress.totalBytes} value={progress.completedBytes} />
            ) : busy ? (
              <div className="agent-hub__indeterminate" role="progressbar" aria-label="Transfer progress" />
            ) : null}
            {resultText && <p>{resultText}</p>}
            {job.error && <p role="alert">{job.error.message}</p>}
            {busy && (
              <button type="button" disabled={cancelPending} onClick={() => void cancel()}>
                {cancelPending ? 'Cancelling…' : 'Cancel transfer'}
              </button>
            )}
            {job.status === 'failed' && lastAction && (
              <button type="button" onClick={() => void startTransfer(lastAction)}>Retry</button>
            )}
          </section>
        )}
        {transferError && <p className="agent-hub__notice" role="alert">{transferError}</p>}

        {loading && (
          <section className="agent-hub__grid" aria-label="Loading Agents">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} aria-label="Loading Agent" className="agent-hub__skeleton" />
            ))}
          </section>
        )}
        {catalogError && (
          <div className="agent-hub__state">
            <FeatureErrorState
              title="Could not refresh the Agent catalog"
              description={catalogError}
              onRetry={() => setReload((value) => value + 1)}
            />
          </div>
        )}
        {!loading && !catalogError && agents.length === 0 && (
          <div className="agent-hub__state">
            <FeatureEmptyState
              title="No Agents available"
              description="Upload an Agent package to start the local demo catalog."
            />
          </div>
        )}
        {!loading && !catalogError && agents.length > 0 && (
          <section className="agent-hub__grid" aria-label="Available Agents">
            {agents.map((agent) => (
              <article key={agent.id}>
                <span>Agent</span>
                <h2>{agent.name}</h2>
                <p>{agent.description}</p>
                <button
                  type="button"
                  disabled={busy || Boolean(unavailableReason)}
                  onClick={() => void startTransfer({ kind: 'download', agent })}
                  aria-label={`Download ${agent.name}`}
                >
                  Download
                </button>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  )
}
