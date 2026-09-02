import { useEffect, useRef, useState } from 'react'
import {
  useFeatureCapability,
  type FeaturePageProps,
  type FeatureServiceErrorV1,
} from '@bibit/feature-sdk'
import {
  INSTALLED_AGENTS,
  POWER_PAGE_SIZE,
  type ListPowersInput,
  type PowerType,
  type ReadyListPowersResult,
} from './api/contracts'
import { listPowers } from './api/powerCatalogClient'
import { PowerCard } from './components/PowerCard'
import { PowerFilters } from './components/PowerFilters'
import { PowerPagination } from './components/PowerPagination'
import './agentHub.css'

type PowerScope = 'installed' | 'market'

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; data: ReadyListPowersResult }
  | { status: 'error'; message: string; retryable: boolean }

const ERROR_MESSAGES: Record<FeatureServiceErrorV1['code'], string> = {
  cancelled: 'Power catalog request was cancelled.',
  offline: 'Power catalog is offline.',
  timeout: 'Power catalog request timed out.',
  unauthorized: 'Power catalog authorization is required.',
  incompatible: 'Power catalog service is incompatible with this plugin.',
  unavailable: 'Power catalog is unavailable.',
  provider_crashed: 'Power catalog provider crashed.',
  resource_exhausted: 'Power catalog resources are exhausted.',
  unknown: 'Could not load Power catalog.',
}

const RETRYABLE_CODES: ReadonlySet<FeatureServiceErrorV1['code']> = new Set([
  'offline',
  'timeout',
  'unavailable',
  'provider_crashed',
  'resource_exhausted',
])

function isFeatureServiceError(value: unknown): value is FeatureServiceErrorV1 {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { version?: unknown; code?: unknown }
  return (
    candidate.version === 1 &&
    typeof candidate.code === 'string' &&
    Object.hasOwn(ERROR_MESSAGES, candidate.code)
  )
}

// The Feature Dev Host's serviceConnections bridge throws new Error(envelope.error.message),
// dropping the structured code/retryable. These exact messages are the only retryable
// "service unreachable" signals it forwards; the page recovers them so an unreachable apm
// renders as unavailable (with Retry) instead of incompatible. In production the host rejects
// with a structured FeatureServiceErrorV1, so this branch only fires in Local Preview.
const APM_CLI_UNAVAILABLE_MESSAGE = 'apm CLI is unavailable'
const DEV_HOST_UNAVAILABLE_MESSAGE = 'External service is unavailable'

function toSafeError(reason: unknown): { message: string; retryable: boolean } {
  if (isFeatureServiceError(reason)) {
    const message = ERROR_MESSAGES[reason.code]
    return {
      message: reason.diagnosticId ? `${message} Diagnostic ID: ${reason.diagnosticId}` : message,
      retryable: RETRYABLE_CODES.has(reason.code),
    }
  }
  if (reason instanceof Error && reason.message === APM_CLI_UNAVAILABLE_MESSAGE) {
    return {
      message: 'Power catalog is unavailable: the apm CLI could not be started.',
      retryable: true,
    }
  }
  if (reason instanceof Error && reason.message === DEV_HOST_UNAVAILABLE_MESSAGE) {
    return { message: ERROR_MESSAGES.unavailable, retryable: true }
  }
  return {
    message: 'Power catalog service is incompatible with this plugin.',
    retryable: false,
  }
}

export function AgentHubPage(_: FeaturePageProps) {
  const store = useFeatureCapability('service:store')
  const [scope, setScope] = useState<PowerScope>('installed')
  const [agent, setAgent] = useState('bibit')
  const [type, setType] = useState<PowerType>('skill')
  const [tags, setTags] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined)
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const generationRef = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    const generation = ++generationRef.current
    setView({ status: 'loading' })

    if (!store) {
      setView({
        status: 'error',
        message: 'Store capability is not available.',
        retryable: true,
      })
      return () => controller.abort()
    }

    const input: ListPowersInput = {
      scope,
      type,
      tags: [...tags].sort(),
      page,
      pageSize: POWER_PAGE_SIZE,
      ...(scope === 'installed' ? { agent } : {}),
      ...(page > 1 && snapshot !== undefined ? { snapshot } : {}),
    }

    void listPowers(store, input, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || generation !== generationRef.current) return
        if (result.status === 'reset_required') {
          if (page === 1) {
            setView({ status: 'error', message: 'Power catalog service is incompatible with this plugin.', retryable: false })
            return
          }
          setSnapshot(undefined)
          setPage(1)
          return
        }
        setSnapshot(result.snapshot)
        setView({ status: 'ready', data: result })
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || generation !== generationRef.current) return
        setView({ status: 'error', ...toSafeError(reason) })
      })

    return () => controller.abort()
  }, [store, scope, agent, type, tags, page, retry])

  const changeScope = (next: PowerScope) => {
    setScope(next)
    setTags([])
    setPage(1)
    setSnapshot(undefined)
  }
  const changeAgent = (next: string) => {
    setAgent(next)
    setTags([])
    setPage(1)
    setSnapshot(undefined)
  }
  const changeType = (next: PowerType) => {
    setType(next)
    setTags([])
    setPage(1)
    setSnapshot(undefined)
  }
  const changeTags = (next: string[]) => {
    setTags([...next].sort())
    setPage(1)
    setSnapshot(undefined)
  }
  const changePage = (nextPage: number) => setPage(nextPage)
  const retryLoad = () => setRetry((value) => value + 1)

  const facets = view.status === 'ready' ? view.data.facets : { agents: [], tags: [] }
  const agents = scope === 'installed' ? INSTALLED_AGENTS : []
  const totalPages =
    view.status === 'ready' ? Math.max(1, Math.ceil(view.data.total / POWER_PAGE_SIZE)) : 1

  return (
    <main className="agent-hub">
      <header><div><p>INTERNAL CATALOG</p><h1>Agent Hub</h1></div></header>
      <PowerFilters
        scope={scope}
        agents={agents}
        agent={agent}
        type={type}
        availableTags={facets.tags}
        selectedTags={tags}
        onScopeChange={changeScope}
        onAgentChange={changeAgent}
        onTypeChange={changeType}
        onTagsChange={changeTags}
      />
      {view.status === 'loading' && <p role="status" className="agent-hub__status">Loading Powers…</p>}
      {view.status === 'error' && (
        <div role="alert" className="agent-hub__error">
          <span>{view.message}</span>
          {view.retryable && <button type="button" onClick={retryLoad}>Retry</button>}
        </div>
      )}
      {view.status === 'ready' && (
        <>
          {view.data.warnings.map((warning, index) => (
            <p key={`${warning.code}-${warning.agent}-${index}`} className="agent-hub__status">
              {warning.message}
            </p>
          ))}
          {view.data.items.length === 0 ? (
            <p className="agent-hub__status">No Powers are available.</p>
          ) : (
            <>
              <section className="agent-hub__grid" aria-label="Available Powers">
                {view.data.items.map((series) => (
                  <PowerCard key={`${series.type}-${series.name}`} series={series} />
                ))}
              </section>
              <PowerPagination
                page={view.data.page}
                totalPages={totalPages}
                canGoNext={view.data.nextPage !== undefined}
                onPageChange={changePage}
              />
            </>
          )}
        </>
      )}
    </main>
  )
}
