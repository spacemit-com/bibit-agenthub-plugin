import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  useFeatureCapability,
  type FeaturePageProps,
  type FeatureServiceApiV1,
  type FeatureServiceErrorV1,
  type FeatureServiceRequestV1,
} from '@bibit/feature-sdk'
import {
  INSTALLED_AGENTS,
  POWER_PAGE_SIZE,
  type ListPowersInput,
  type PowerType,
  type ReadyListPowersResult,
  type PowerSeries,
} from './api/contracts'
import { useAgentHubI18n } from './agentHubI18n'
import { listPowers } from './api/powerCatalogClient'
import {
  getInstallationStore,
  type InstallationSnapshot,
} from './api/installationStore'
import { type MutationIntent } from './api/powerOperations'
import { PowerCard } from './components/PowerCard'
import { PowerDetailsDialog } from './components/PowerDetailsDialog'
import { PowerFilters } from './components/PowerFilters'
import { PowerPagination } from './components/PowerPagination'
import './agentHub.css'

type PowerScope = 'installed' | 'market'

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; data: ReadyListPowersResult }
  | {
      status: 'error'
      /** English source text; translated where it renders. */
      message: string
      /** Host-supplied correlation id, shown as its own sentence. */
      diagnosticId?: string
      retryable: boolean
    }

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
const APC_CATALOG_UNAVAILABLE_MESSAGE = 'APC catalog is unavailable'
const DEV_HOST_UNAVAILABLE_MESSAGE = 'External service is unavailable'

function toSafeError(reason: unknown): {
  message: string
  diagnosticId?: string
  retryable: boolean
} {
  if (isFeatureServiceError(reason)) {
    return {
      message: ERROR_MESSAGES[reason.code],
      ...(reason.diagnosticId ? { diagnosticId: reason.diagnosticId } : {}),
      retryable: RETRYABLE_CODES.has(reason.code),
    }
  }
  if (reason instanceof Error && reason.message === APM_CLI_UNAVAILABLE_MESSAGE) {
    return {
      message: 'Power catalog is unavailable: the apm CLI could not be started.',
      retryable: true,
    }
  }
  if (reason instanceof Error && reason.message === APC_CATALOG_UNAVAILABLE_MESSAGE) {
    return {
      message: 'Power catalog is unavailable: the APC catalog could not be loaded.',
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

function itemKey(agent: string, type: string, name: string): string {
  return JSON.stringify([agent, type, name])
}

function versionKey(type: string, name: string): string {
  return JSON.stringify([type, name])
}

const EMPTY_SNAPSHOT: InstallationSnapshot = {
  revision: 0,
  items: new Map(),
  fullLists: new Map(),
  notices: new Map(),
}

const noopSubscribe = () => () => {}
const noopSnapshot = () => EMPTY_SNAPSHOT

export function AgentHubPage(_: FeaturePageProps) {
  // The host recreates the `service:store` capability object on every render of
  // the feature host (Bibit's FeatureContributionHost calls hostApiFactory during
  // render without memoization). Depending on that identity would abort and
  // restart every in-flight request and would discard the per-service WeakMap
  // caches (market catalog, installation store) on every host render. Pin one
  // stable proxy per page instance that always delegates to the latest object,
  // so in-flight work survives host renders while token rotation still applies.
  const capability = useFeatureCapability('service:store')
  const capabilityRef = useRef(capability)
  capabilityRef.current = capability
  const hasStore = capability !== undefined
  const store = useMemo<FeatureServiceApiV1<'store'> | undefined>(() => {
    if (!hasStore) return undefined
    const proxy: FeatureServiceApiV1<'store'> = {
      request<TResult = unknown>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
        const current = capabilityRef.current
        if (!current) {
          return Promise.reject<TResult>(
            Object.assign(new Error('Store capability is not available.'), {
              version: 1,
              code: 'unavailable',
              retryable: true,
            })
          )
        }
        return current.request<TResult>(input)
      },
    }
    return proxy
  }, [hasStore])

  const t = useAgentHubI18n()

  const [scope, setScope] = useState<PowerScope>('installed')
  const [agent, setAgent] = useState('bibit')
  const [type, setType] = useState<PowerType>('skill')
  const [tags, setTags] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined)
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const generationRef = useRef(0)

  const [selectedVersions, setSelectedVersions] = useState<ReadonlyMap<string, string>>(new Map())
  const [dialog, setDialog] = useState<PowerSeries | null>(null)
  const [dialogAgent, setDialogAgent] = useState('bibit')

  const executeControllerRef = useRef<AbortController | null>(null)
  const inspectControllerRef = useRef<AbortController | null>(null)
  // The page owns its scroll container (the host clips the contribution's box), so a
  // query change must put the new list back at the top instead of keeping the offset.
  const pageScrollRef = useRef<HTMLElement>(null)

  const installationStore = store ? getInstallationStore(store) : undefined
  const installationSnapshot = useSyncExternalStore(
    installationStore ? installationStore.subscribe : noopSubscribe,
    installationStore ? installationStore.getSnapshot : noopSnapshot
  )

  // ---- store-driven view refresh after a mutation completes ----
  const wasActiveRef = useRef(false)
  useEffect(() => {
    const isActive = installationSnapshot.active !== undefined
    if (wasActiveRef.current && !isActive) {
      setPage(1)
      setRetry((value) => value + 1)
    }
    wasActiveRef.current = isActive
  }, [installationSnapshot.active, installationSnapshot.revision])

  // ---- window focus refreshes the read view ----
  useEffect(() => {
    const onFocus = () => {
      if (!installationSnapshot.active) setRetry((value) => value + 1)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [installationSnapshot.active])

  // ---- page lifecycle: abort everything and invalidate the agent ----
  useEffect(() => {
    return () => {
      executeControllerRef.current?.abort()
      inspectControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const listController = new AbortController()
    const generation = ++generationRef.current
    setView({ status: 'loading' })

    if (!store) {
      setView({
        status: 'error',
        message: 'Store capability is not available.',
        retryable: true,
      })
      return () => listController.abort()
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

    void listPowers(store, input, listController.signal)
      .then((result) => {
        if (listController.signal.aborted || generation !== generationRef.current) return
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
        if (listController.signal.aborted || generation !== generationRef.current) return
        setView({ status: 'error', ...toSafeError(reason) })
      })

    return () => listController.abort()
  }, [store, scope, agent, type, tags, page, retry])

  // ---- the page owns its scroll: size it to the box the host actually hands over ----
  // A page contribution is mounted in a min-height based box (SidebarProvider /
  // SidebarInset are `min-h-svh`), so a percentage height never resolves and the page
  // would grow with its content instead of scrolling. The stylesheet approximates the box
  // with viewport units; measuring the real offset removes the assumption, and re-running
  // on resize keeps the scroller flush with the bottom of the window.
  useLayoutEffect(() => {
    const node = pageScrollRef.current
    if (!node) return
    const fitToHostBox = () => {
      const top = node.getBoundingClientRect().top
      node.style.height = `${Math.max(0, Math.round(window.innerHeight - top))}px`
    }
    fitToHostBox()
    window.addEventListener('resize', fitToHostBox)
    return () => window.removeEventListener('resize', fitToHostBox)
  }, [])

  // ---- scrollbars: show the position indicator only while a scroller is moving ----
  // Scroll events do not bubble, but a capture-phase listener on the page root still sees
  // every nested scroller (the description box, the tag rows, the details dialog). The flag
  // is cleared shortly after the last scroll event, which is what makes the bar feel like
  // the desktop's auto-hiding indicator instead of a permanently visible one.
  useEffect(() => {
    const node = pageScrollRef.current
    if (!node) return
    const timers = new Map<HTMLElement, number>()
    const SCROLLBAR_IDLE_MS = 1000
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      target.dataset.scrolling = 'true'
      window.clearTimeout(timers.get(target))
      timers.set(
        target,
        window.setTimeout(() => {
          delete target.dataset.scrolling
          timers.delete(target)
        }, SCROLLBAR_IDLE_MS)
      )
    }
    node.addEventListener('scroll', onScroll, true)
    return () => {
      node.removeEventListener('scroll', onScroll, true)
      for (const timer of timers.values()) window.clearTimeout(timer)
    }
  }, [])

  const resetPageScroll = () => {
    if (pageScrollRef.current) pageScrollRef.current.scrollTop = 0
  }
  const changeScope = (next: PowerScope) => {
    resetPageScroll()
    setScope(next)
    setTags([])
    setPage(1)
    setSnapshot(undefined)
  }
  const changeAgent = (next: string) => {
    resetPageScroll()
    setAgent(next)
    setTags([])
    setPage(1)
    setSnapshot(undefined)
  }
  const changeType = (next: PowerType) => {
    resetPageScroll()
    setType(next)
    setTags([])
    setPage(1)
    setSnapshot(undefined)
  }
  const changeTags = (next: string[]) => {
    resetPageScroll()
    setTags([...next].sort())
    setPage(1)
    setSnapshot(undefined)
  }
  const changePage = (nextPage: number) => {
    resetPageScroll()
    setPage(nextPage)
  }
  const retryLoad = () => setRetry((value) => value + 1)

  const selectedVersionFor = useCallback(
    (series: PowerSeries) => selectedVersions.get(versionKey(series.type, series.name)) ?? series.versions[0].version,
    [selectedVersions]
  )

  const changeVersion = (series: PowerSeries, version: string) => {
    setSelectedVersions((prev) => {
      const next = new Map(prev)
      next.set(versionKey(series.type, series.name), version)
      return next
    })
  }

  const inspectTarget = useCallback(
    (targetAgent: string, series: PowerSeries) => {
      if (!installationStore) return
      inspectControllerRef.current?.abort()
      const controller = new AbortController()
      inspectControllerRef.current = controller
      void installationStore
        .inspect({ agent: targetAgent, type: series.type, name: series.name }, controller.signal)
        .catch(() => {})
    },
    [installationStore]
  )

  const openDetails = (series: PowerSeries) => {
    const targetAgent = scope === 'installed' ? agent : 'bibit'
    setDialogAgent(targetAgent)
    setDialog(series)
    inspectTarget(targetAgent, series)
  }

  const closeDetails = () => {
    inspectControllerRef.current?.abort()
    inspectControllerRef.current = null
    setDialog(null)
  }

  const changeDialogAgent = (next: string) => {
    setDialogAgent(next)
    if (dialog) inspectTarget(next, dialog)
  }

  const runMutation = useCallback(
    (intent: MutationIntent) => {
      if (!installationStore) return
      executeControllerRef.current?.abort()
      const controller = new AbortController()
      executeControllerRef.current = controller
      void installationStore.execute(intent, controller.signal)
    },
    [installationStore]
  )

  const installSelected = () => {
    if (!dialog) return
    runMutation({
      kind: 'install',
      input: {
        agent: dialogAgent,
        type: dialog.type,
        name: dialog.name,
        version: selectedVersionFor(dialog),
      },
    })
  }

  const uninstallDialog = () => {
    if (!dialog) return
    runMutation({
      kind: 'uninstall',
      input: { agent: dialogAgent, type: dialog.type, name: dialog.name },
    })
  }

  const isBusyFor = (targetAgent: string, series: PowerSeries) => {
    const active = installationSnapshot.active
    if (!active) return false
    return (
      active.intent.input.agent === targetAgent &&
      active.intent.input.type === series.type &&
      active.intent.input.name === series.name
    )
  }

  const retryInspect = () => {
    if (dialog) inspectTarget(dialogAgent, dialog)
  }

  const facets = view.status === 'ready' ? view.data.facets : { agents: [], tags: [] }
  const agents = scope === 'installed' ? INSTALLED_AGENTS : []
  const totalPages =
    view.status === 'ready' ? Math.max(1, Math.ceil(view.data.total / POWER_PAGE_SIZE)) : 1

  const dialogInstallation =
    dialog !== null
      ? installationSnapshot.items.get(itemKey(dialogAgent, dialog.type, dialog.name)) ?? { status: 'unknown' }
      : null
  const dialogNotice =
    dialog !== null
      ? installationSnapshot.notices.get(itemKey(dialogAgent, dialog.type, dialog.name))
      : undefined

  return (
    <main className="agent-hub" ref={pageScrollRef}>
      <header><div><p>{t('INTERNAL CATALOG')}</p><h1>Agent Hub</h1></div></header>
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
      {view.status === 'loading' && (
        <p role="status" className="agent-hub__status">{t('Loading Powers…')}</p>
      )}
      {view.status === 'error' && (
        <div role="alert" className="agent-hub__error">
          <span>{t(view.message)}</span>
          {view.diagnosticId && (
            <span>{t('Diagnostic ID: {diagnosticId}', { diagnosticId: view.diagnosticId })}</span>
          )}
          {view.retryable && <button type="button" onClick={retryLoad}>{t('Retry')}</button>}
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
            <p className="agent-hub__status">{t('No Powers are available.')}</p>
          ) : (
            <>
              <section className="agent-hub__grid" aria-label={t('Available Powers')}>
                {view.data.items.map((series) => (
                  <PowerCard
                    key={`${series.type}-${series.name}`}
                    series={series}
                    selectedVersion={selectedVersionFor(series)}
                    onVersionChange={(version) => changeVersion(series, version)}
                    busy={isBusyFor(agent, series)}
                    notice={
                      scope === 'installed'
                        ? installationSnapshot.notices.get(itemKey(agent, series.type, series.name))
                        : undefined
                    }
                    onDetails={() => openDetails(series)}
                  />
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
      {dialog && dialogInstallation && (
        <PowerDetailsDialog
          series={dialog}
          selectedVersion={selectedVersionFor(dialog)}
          agent={dialogAgent}
          installation={dialogInstallation}
          active={installationSnapshot.active}
          notice={dialogNotice}
          readOnly={scope === 'installed'}
          onVersionChange={(version) => changeVersion(dialog, version)}
          onAgentChange={changeDialogAgent}
          onInstall={installSelected}
          onUninstall={uninstallDialog}
          onRetry={retryInspect}
          onClose={closeDetails}
        />
      )}
    </main>
  )
}
