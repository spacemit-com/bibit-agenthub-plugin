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
  comparePowerVersions,
  powerTypesForAgent,
  type ListPowersInput,
  type PowerScope,
  type PowerType,
  type ReadyListPowersResult,
  type PowerSeries,
} from './api/contracts'
import { ScrollThumb } from './ScrollThumb'
import { useAgentHubI18n, type TranslatableText } from './agentHubI18n'
import { listPowers } from './api/powerCatalogClient'
import { powerSeriesKey } from './api/apm'
import { deleteCustomResource, submissionIdFrom, uploadCustomResource } from './api/customResources'
import {
  ACTIONS_UNAVAILABLE_TEXT,
  COMPOSE_RETRY_HINT,
  composePrompt,
  composeResource,
  type ComposeNotice,
} from './api/conversationCompose'
import {
  getInstallationStore,
  type InstallationSnapshot,
} from './api/installationStore'
import { type MutationIntent } from './api/powerOperations'
import { PowerCard } from './components/PowerCard'
import { PowerDetailsDialog, type CustomActionState } from './components/PowerDetailsDialog'
import { PowerFilters, type PowerTab } from './components/PowerFilters'
import { AgentHubSettingsPanel } from './components/AgentHubSettingsPanel'
import { PowerPagination } from './components/PowerPagination'
import './agentHub.css'

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

// `cancelled` is retryable on purpose. The store reports it when a request is
// superseded or the provider session is torn down, not when the user cancels
// anything, so ending on a message with no action would dead-end the page.
const RETRYABLE_CODES: ReadonlySet<FeatureServiceErrorV1['code']> = new Set([
  'offline',
  'timeout',
  'cancelled',
  'unavailable',
  'provider_crashed',
  'resource_exhausted',
])

/**
 * English source text for a failed custom-resource write, by platform code. The
 * messages are deliberately operation-neutral so one table covers upload and
 * delete; a credential problem is the one case that tells the user where to fix
 * it.
 */
const CUSTOM_ERROR_MESSAGES: Record<FeatureServiceErrorV1['code'], string> = {
  cancelled: 'The custom resource request was cancelled.',
  offline: 'The custom resource service is offline.',
  timeout: 'The custom resource request timed out.',
  unauthorized: 'APC API Key is not configured; set it in the Settings tab.',
  incompatible: 'The custom resource service is incompatible with this plugin.',
  unavailable: 'The custom resource service is unavailable.',
  provider_crashed: 'The custom resource provider crashed.',
  resource_exhausted: 'The custom resource request exceeded a resource limit.',
  unknown: 'The custom resource operation failed.',
}

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

const EMPTY_SNAPSHOT: InstallationSnapshot = {
  revision: 0,
  items: new Map(),
  fullLists: new Map(),
  notices: new Map(),
  confirmedRemovals: new Set(),
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

  // `host:actions` is the only cross-Feature channel this page may use, and its
  // absence is a supported state rather than an error: without it the create
  // entry stays disabled and says why. The reference is pinned for the same
  // reason as the store capability above — the host rebuilds the capability
  // object on every render — so the click handler reads the current one.
  const actions = useFeatureCapability('host:actions')
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const [composing, setComposing] = useState(false)
  const [composeNotice, setComposeNotice] = useState<ComposeNotice | undefined>(undefined)
  // A compose result that lands after unmount (the host navigates away on
  // success) must not touch state any more.
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const createResource = () => {
    const current = actionsRef.current
    // Depth in defence of the disabled entry: a missing capability can never
    // turn into a request, and a second click cannot start a second call.
    if (!current || composing) return
    setComposing(true)
    setComposeNotice(undefined)
    void composeResource(current, composePrompt(t))
      .then((outcome) => {
        if (!mountedRef.current) return
        if (outcome.status === 'rejected') setComposeNotice(outcome.notice)
      })
      .finally(() => {
        if (mountedRef.current) setComposing(false)
      })
  }

  const [scope, setScope] = useState<PowerScope>('installed')
  // The first-level tab: the two catalog scopes plus the in-page Settings panel.
  // `scope` stays the data scope, so switching to Settings keeps the list state
  // and no catalog request is issued for a panel that shows no Powers.
  const [tab, setTab] = useState<PowerTab>('installed')
  const [agent, setAgent] = useState('bibit')
  const [type, setType] = useState<PowerType>('skill')
  const [tags, setTags] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined)
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const generationRef = useRef(0)

  /**
   * The version the dialog is showing. The card no longer chooses one, so this is
   * set when the dialog opens -- always to the newest the series lists -- and only
   * the dialog's own selector changes it.
   */
  const [dialogVersion, setDialogVersion] = useState('')
  const [dialog, setDialog] = useState<PowerSeries | null>(null)
  /** In-flight custom write, keyed by resource so the dialog only shows its own. */
  const [customAction, setCustomAction] = useState<{ key: string; state: CustomActionState } | null>(null)
  const [customNotices, setCustomNotices] = useState<ReadonlyMap<string, TranslatableText>>(new Map())

  const executeControllerRef = useRef<AbortController | null>(null)
  const inspectControllerRef = useRef<AbortController | null>(null)
  const customControllerRef = useRef<AbortController | null>(null)
  // The page owns its scroll container (the host clips the contribution's box), so a
  // query change must put the new list back at the top instead of keeping the offset.
  const pageScrollRef = useRef<HTMLElement>(null)

  const installationStore = store ? getInstallationStore(store) : undefined
  const installationSnapshot = useSyncExternalStore(
    installationStore ? installationStore.subscribe : noopSubscribe,
    installationStore ? installationStore.getSnapshot : noopSnapshot
  )

  // Declared before the mutation effect below, which closes the dialog when an
  // uninstall is confirmed gone.
  const closeDetails = useCallback(() => {
    inspectControllerRef.current?.abort()
    inspectControllerRef.current = null
    // A custom write keeps running (the provider owns the subprocess), but the
    // page must not keep resolving the dialog it no longer shows.
    setDialog(null)
  }, [])

  // ---- store-driven view refresh after a mutation completes ----
  const wasActiveRef = useRef(false)
  useEffect(() => {
    const isActive = installationSnapshot.active !== undefined
    if (wasActiveRef.current && !isActive) {
      setPage(1)
      setRetry((value) => value + 1)
      // An uninstall that is confirmed gone closes its dialog: staying on a Power
      // that is no longer installed hides the reinstall entry point. A failure
      // keeps the dialog, which is where its reason is shown.
      if (dialog !== null && installationSnapshot.confirmedRemovals.has(itemKey(agent, dialog.type, dialog.name))) {
        closeDetails()
      }
    }
    wasActiveRef.current = isActive
  }, [
    installationSnapshot.active,
    installationSnapshot.revision,
    installationSnapshot.confirmedRemovals,
    dialog,
    agent,
    closeDetails,
  ])

  // ---- window focus refreshes the read view ----
  // Focus must not restart a load that is already running: bumping `retry` aborts the
  // in-flight request and re-issues it, and a market read pulls the whole catalog over
  // the network, so a focus event used to surface as a spurious cancellation. The
  // status is read through a ref so the listener stays stable across renders.
  const viewStatusRef = useRef(view.status)
  viewStatusRef.current = view.status
  useEffect(() => {
    const onFocus = () => {
      if (installationSnapshot.active) return
      if (viewStatusRef.current === 'loading') return
      setRetry((value) => value + 1)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [installationSnapshot.active])

  // ---- page lifecycle: abort everything and invalidate the agent ----
  useEffect(() => {
    return () => {
      executeControllerRef.current?.abort()
      inspectControllerRef.current?.abort()
      customControllerRef.current?.abort()
    }
  }, [])

  // The list depends on the Agent only in the installed scope: the market catalog
  // is Agent-independent, so switching the Agent while browsing the market must
  // neither refetch it nor clear the tag/page state the user just set.
  const listAgent = scope === 'installed' ? agent : undefined

  useEffect(() => {
    // The Settings tab renders the credential panel, not a catalog list: it must
    // neither issue a `powers.list.v1` request nor leave the previous one running
    // behind it, so the effect stops before touching `view`.
    if (tab === 'settings') return

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
      ...(listAgent !== undefined ? { agent: listAgent } : {}),
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
  }, [store, scope, tab, listAgent, type, tags, page, retry])

  // ---- the market preloads the chosen Agent's install manifest ----
  // The market catalog is Agent-independent -- its list request carries no `agent` --
  // but a market card still has to say whether the Power is already installed for the
  // Agent the user chose. Read on entering the market, on an Agent change and on the
  // window-focus refresh, matching the installed scope, which re-reads its manifest on
  // the same occasions.
  //
  // `tab` rather than `scope` is the guard: on the Settings tab `scope` still holds the
  // previous catalog scope, and no list (and so no badge) is rendered there.
  //
  // Best-effort: the badge is an addition to browsing, so an unreadable manifest must
  // leave the catalog usable and simply show no badges. The install action surfaces the
  // same failure with its own message when it is attempted.
  useEffect(() => {
    if (tab !== 'market' || !installationStore) return
    const controller = new AbortController()
    void installationStore.refreshAgent(agent, controller.signal).catch(() => {})
    return () => controller.abort()
  }, [tab, agent, installationStore, retry])

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

  const resetPageScroll = () => {
    if (pageScrollRef.current) pageScrollRef.current.scrollTop = 0
  }
  const changeTab = (next: PowerTab) => {
    resetPageScroll()
    setTab(next)
    // The Settings tab is not a catalog scope: it keeps whatever the last list
    // query was, so returning to a Powers tab resumes exactly where the user was.
    if (next === 'settings') return
    setScope(next)
    setTags([])
    setPage(1)
    setSnapshot(undefined)
  }
  const changeAgent = (next: string) => {
    resetPageScroll()
    setAgent(next)
    // The `agent` type is bibit-only, so its filter chip is not rendered for any
    // other Agent. A query left on that hidden type would strand the list on
    // something the user can no longer see or switch away from, so it falls back
    // to the first type the new Agent does take, with the reset an explicit type
    // change would get.
    const supported = powerTypesForAgent(next)
    const typeFellAway = !supported.includes(type)
    if (typeFellAway) setType(supported[0])
    // Only the installed list is read per Agent, so only there does the Agent
    // alone reset the query; on the market the choice just moves the install
    // target and the catalog the user is browsing must stay where it is.
    if (!typeFellAway && scope !== 'installed') return
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
    setDialog(series)
    // The dialog opens on the newest version the series lists.
    setDialogVersion(series.versions[0].version)
    // A hand-installed resource is not in the APM manifest, so an inspect would
    // only ask apm about a Power it does not manage. The custom dialog renders
    // its own facts instead of the installation lifecycle.
    if (series.source !== 'custom') inspectTarget(agent, series)
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
        agent,
        type: dialog.type,
        name: dialog.name,
        version: dialogVersion,
      },
    })
  }

  const uninstallDialog = () => {
    if (!dialog) return
    runMutation({
      kind: 'uninstall',
      input: { agent, type: dialog.type, name: dialog.name },
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

  const setCustomNotice = (key: string, notice: TranslatableText | undefined) => {
    setCustomNotices((prev) => {
      const next = new Map(prev)
      if (notice === undefined) next.delete(key)
      else next.set(key, notice)
      return next
    })
  }

  /**
   * Runs one custom write. The controller is kept in a ref and replaced on every
   * call, so a second click cannot leave an orphaned request, and the page
   * unmount aborts whatever is in flight. A finished write always re-reads the
   * installed view: upload may have changed nothing locally, but the scan is the
   * only authority for what is on disk.
   *
   * `closeOnSuccess` is for a write that removes the resource: the dialog it
   * describes has nothing left to act on, so the page returns to the list instead
   * of keeping a modal open on a Power that no longer exists. A failed write
   * always keeps the dialog so its reason stays readable.
   */
  const runCustomAction = useCallback(
    async (
      kind: CustomActionState['kind'],
      series: PowerSeries,
      targetAgent: string,
      run: (signal: AbortSignal) => Promise<TranslatableText>,
      options?: { closeOnSuccess?: boolean }
    ) => {
      if (!store) return
      customControllerRef.current?.abort()
      const controller = new AbortController()
      customControllerRef.current = controller
      const key = itemKey(targetAgent, series.type, series.name)
      setCustomNotice(key, undefined)
      setCustomAction({ key, state: { kind, phase: 'running' } })
      let notice: TranslatableText
      let succeeded = false
      try {
        notice = await run(controller.signal)
        succeeded = true
      } catch (reason: unknown) {
        if (controller.signal.aborted) return
        const code =
          typeof reason === 'object' && reason !== null && typeof (reason as { code?: unknown }).code === 'string'
            ? ((reason as { code: FeatureServiceErrorV1['code'] }).code)
            : 'unknown'
        notice = { text: CUSTOM_ERROR_MESSAGES[code] ?? CUSTOM_ERROR_MESSAGES.unknown }
      }
      if (controller.signal.aborted) return
      setCustomAction((current) => (current?.key === key ? { key, state: { kind, phase: 'reconciling' } } : current))
      if (succeeded && options?.closeOnSuccess) {
        // Leaving the page on a deleted resource's page number would show an empty
        // list, so the successful removal also returns to the first page.
        setPage(1)
        setCustomNotice(key, undefined)
        closeDetails()
      } else {
        setCustomNotice(key, notice)
      }
      setCustomAction((current) => (current?.key === key ? null : current))
      setRetry((value) => value + 1)
    },
    [store, closeDetails]
  )

  const uploadDialog = (message: string) => {
    if (!dialog || !store) return
    void runCustomAction('upload', dialog, agent, async (signal) => {
      const result = await uploadCustomResource(
        store,
        { agent, type: dialog.type, name: dialog.name, message },
        signal
      )
      if (result.exitCode !== 0) {
        // apm rejected the resource or the submission. Its sanitized diagnostic
        // (the real reason behind the exit code) is the only actionable text, so
        // it becomes the notice; without one, the stage names what failed.
        const failure: TranslatableText = result.reason
          ? { text: 'Upload failed: {reason}', values: { reason: result.reason } }
          : result.stage === 'validate'
            ? { text: 'This resource does not meet the Power format required for upload; fix it and retry.' }
            : { text: 'Upload failed.' }
        return failure
      }
      const submissionId = submissionIdFrom(result.stdout)
      const success: TranslatableText =
        submissionId !== undefined
          ? { text: 'Upload complete: {submissionId}', values: { submissionId } }
          : { text: 'Upload complete.' }
      return success
    })
  }

  const deleteDialog = () => {
    if (!dialog || !store) return
    const target = { type: dialog.type, name: dialog.name }
    // The type now reads the same in the wire value and in the sentence; there is no
    // label mapping to apply.
    const messageValues = { type: dialog.type, name: dialog.name }
    void runCustomAction(
      'delete',
      dialog,
      agent,
      async (signal) => {
        await deleteCustomResource(store, { agent, ...target }, signal)
        // The page closes the dialog instead of showing this, so the text only
        // documents the outcome of the write it just performed.
        return { text: 'Deleted {type} "{name}".', values: messageValues }
      },
      { closeOnSuccess: true }
    )
  }

  const retryInspect = () => {
    if (dialog) inspectTarget(agent, dialog)
  }

  // `facets.agents` is not read anywhere: the Agent list is the fixed
  // `INSTALLED_AGENTS` constant, so agent discovery is never performed.
  const availableTags = view.status === 'ready' ? view.data.facets.tags : []
  // `fullLists` is keyed by Agent and is the manifest a market card's badges read. The
  // market catalog is Agent-independent, so membership has to be resolved against the
  // Agent the user chose rather than against the scope the list was read in. Rebuilt
  // per publish because the store hands out a fresh Map each time. A series could in
  // principle have several installed records, so the newest wins: "something newer
  // exists" has to compare against what is actually the latest on disk.
  const installedVersions = useMemo(() => {
    const records = installationSnapshot.fullLists.get(agent) ?? []
    const versions = new Map<string, string>()
    for (const record of records) {
      const key = powerSeriesKey(record.type, record.name)
      const known = versions.get(key)
      if (known === undefined || comparePowerVersions(record.version, known) > 0) {
        versions.set(key, record.version)
      }
    }
    return versions
  }, [installationSnapshot.fullLists, agent])
  const totalPages =
    view.status === 'ready' ? Math.max(1, Math.ceil(view.data.total / POWER_PAGE_SIZE)) : 1

  const dialogInstallation =
    dialog !== null
      ? installationSnapshot.items.get(itemKey(agent, dialog.type, dialog.name)) ?? { status: 'unknown' }
      : null
  const dialogNotice =
    dialog !== null
      ? installationSnapshot.notices.get(itemKey(agent, dialog.type, dialog.name))
      : undefined
  const dialogCustomNotice =
    dialog !== null ? customNotices.get(itemKey(agent, dialog.type, dialog.name)) : undefined
  const dialogCustomAction =
    dialog !== null && customAction !== null && customAction.key === itemKey(agent, dialog.type, dialog.name)
      ? customAction.state
      : undefined

  // A host-authored notice is already localized by the host and is rendered as-is;
  // only the plugin's own sentences go through the translator.
  const noticeText = (notice: ComposeNotice) =>
    [
      notice.origin === 'plugin' ? t(notice.text) : notice.text,
      notice.retryable ? t(COMPOSE_RETRY_HINT) : '',
    ]
      .filter(Boolean)
      .join(' ')

  return (
    <main className="agent-hub" ref={pageScrollRef}>
      <ScrollThumb targetRef={pageScrollRef} />
      <header>
        <div><h1>{t('Capabilities')}</h1></div>
        <div className="agent-hub__create">
          {/* The two header actions share one row, refresh on the left. The refresh
              entry is a catalog action: the Settings tab reads its own settings
              document and shows no list, so the button is not rendered there. */}
          <div className="agent-hub__actions">
            {tab !== 'settings' && (
              <button
                type="button"
                className="agent-hub__refresh"
                aria-label={t('Refresh')}
                title={t('Refresh')}
                // Disabled rather than ignoring the click: bumping `retry` aborts the
                // request in flight and re-issues it, which is exactly the spurious
                // cancellation the window-focus refresh above avoids.
                disabled={view.status === 'loading'}
                onClick={retryLoad}
              >
                <span aria-hidden="true">↻</span>
              </button>
            )}
            <button
              type="button"
              disabled={!actions || composing}
              aria-describedby={actions ? undefined : 'agent-hub-create-unavailable'}
              onClick={createResource}
            >
              {t('Create')}
            </button>
          </div>
          {!actions && (
            <p id="agent-hub-create-unavailable" className="agent-hub__create-note">
              {t(ACTIONS_UNAVAILABLE_TEXT)}
            </p>
          )}
        </div>
      </header>
      {composeNotice && (
        <div role="alert" className="agent-hub__error">
          <span>{noticeText(composeNotice)}</span>
        </div>
      )}
      <PowerFilters
        tab={tab}
        agents={INSTALLED_AGENTS}
        agent={agent}
        type={type}
        availableTags={availableTags}
        selectedTags={tags}
        onTabChange={changeTab}
        onAgentChange={changeAgent}
        onTypeChange={changeType}
        onTagsChange={changeTags}
      />
      {tab === 'settings' ? (
        <AgentHubSettingsPanel service={store} />
      ) : (
        <>
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
                  {t(warning.message, warning.values)}
                </p>
              ))}
              {view.data.items.length === 0 ? (
                /* One message for every empty list hid the cause: a tag selection that
                   matched nothing and a type the chosen Agent has none of both read
                   "No Powers are available.", and only the first has a fix to click.
                   Name the filter that is actually excluding the results. The type is
                   not named as the culprit when tags are set, because both are filters
                   and only the tag selection is cleared by the one action offered --
                   the type chips are already on screen for that. */
                <div className="agent-hub__empty" role="status">
                  <p>
                    {tags.length > 0
                      ? t('No powers match these tags.')
                      : scope === 'installed'
                        ? t('No {type} powers are installed for {agent}.', { type, agent })
                        : t('No {type} powers in the catalog.', { type })}
                  </p>
                  {tags.length > 0 && (
                    <button type="button" onClick={() => changeTags([])}>
                      {t('Clear tags')}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <section className="agent-hub__grid" aria-label={t('Available Powers')}>
                    {view.data.items.map((series) => {
                      // Only the market badges: every card on the installed tab is
                      // installed by definition, so a badge there would be noise.
                      const installedVersion =
                        scope === 'market'
                          ? installedVersions.get(powerSeriesKey(series.type, series.name))
                          : undefined
                      return (
                        <PowerCard
                          key={`${series.type}-${series.name}`}
                          series={series}
                          busy={isBusyFor(agent, series)}
                          installed={installedVersion !== undefined}
                          // `New` is only meaningful relative to an installed version.
                          hasNewer={
                            installedVersion !== undefined &&
                            comparePowerVersions(series.versions[0].version, installedVersion) > 0
                          }
                          notice={
                            scope === 'installed'
                              ? installationSnapshot.notices.get(itemKey(agent, series.type, series.name))
                              : undefined
                          }
                          onDetails={() => openDetails(series)}
                        />
                      )
                    })}
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
        </>
      )}
      {dialog && dialogInstallation && (
        <PowerDetailsDialog
          series={dialog}
          selectedVersion={dialogVersion}
          agent={agent}
          installation={dialogInstallation}
          active={installationSnapshot.active}
          notice={dialogNotice}
          readOnly={scope === 'installed'}
          customAction={dialogCustomAction}
          customNotice={dialogCustomNotice}
          onUpload={uploadDialog}
          onDelete={deleteDialog}
          onVersionChange={setDialogVersion}
          onInstall={installSelected}
          onUninstall={uninstallDialog}
          onRetry={retryInspect}
          onClose={closeDetails}
        />
      )}
    </main>
  )
}
