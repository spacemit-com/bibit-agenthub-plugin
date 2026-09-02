import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  FeatureHostApiProvider,
  type FeatureServiceApiV1,
  type FeatureServiceErrorV1,
  type FeatureServiceRequestV1,
  type FeatureHostApiV1,
  type FeatureHostCapabilityApiV1,
  type FeaturePageProps,
} from '@bibit/feature-sdk'
import type { FeatureHostCapability } from '@bibit/feature-contracts'
import type { ListPowersInput, PowerSeries, ReadyListPowersResult } from './api/contracts'
import { AgentHubPage } from './AgentHubPage'

afterEach(cleanup)

type StoreRequest = FeatureServiceRequestV1<'store'>

const codeReview: PowerSeries = {
  type: 'skill',
  name: 'code-review',
  versions: [{ version: 'v1.0.0', description: 'Peer review workflow.', tags: ['quality'] }],
}

const secondPageSkill: PowerSeries = {
  type: 'skill',
  name: 'second-page',
  versions: [{ version: 'v1.0.0', description: 'Second page skill.', tags: [] }],
}

const pluginSeries: PowerSeries = {
  type: 'plugin',
  name: 'scan-guard',
  versions: [{ version: 'v1.0.0', description: 'Guards dependency scans.', tags: [] }],
}

const marketSeries: PowerSeries = {
  type: 'skill',
  name: 'market-translate',
  versions: [{ version: 'v1.0.0', description: 'Translates text.', tags: [] }],
}

const staleSeries: PowerSeries = {
  type: 'skill',
  name: 'stale-skill',
  versions: [{ version: 'v1.0.0', description: 'Stale result.', tags: [] }],
}

function readyResult(overrides: Partial<ReadyListPowersResult> = {}): ReadyListPowersResult {
  return {
    status: 'ready',
    snapshot: 'snap-1',
    items: [codeReview],
    page: 1,
    pageSize: 20,
    total: 1,
    facets: { agents: [], tags: [] },
    warnings: [],
    ...overrides,
  }
}

function paramsOf(call: StoreRequest): ListPowersInput {
  return call.params as unknown as ListPowersInput
}

function makeStoreHost(
  respond?: (input: StoreRequest) => unknown
): { hostApi: FeatureHostApiV1; calls: StoreRequest[] } {
  const calls: StoreRequest[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: StoreRequest): Promise<TResult> {
      calls.push(input)
      if (respond) return (await respond(input)) as TResult
      return readyResult() as TResult
    },
  }
  function getCapability<K extends FeatureHostCapability>(
    capability: K
  ): FeatureHostCapabilityApiV1<K> | undefined {
    if ((capability as FeatureHostCapability) === 'service:store') {
      return service as unknown as FeatureHostCapabilityApiV1<K>
    }
    return undefined
  }
  const hostApi: FeatureHostApiV1 = {
    sdkApiVersion: 1,
    featureId: 'agent-hub',
    grantedCapabilities: ['service:store'],
    getCapability,
  }
  return { hostApi, calls }
}

const pageProps: FeaturePageProps = {
  featureId: 'agent-hub',
  contributionId: 'home',
  subpath: '',
  search: {},
  navigation: { push: () => {}, replace: () => {}, back: () => {} },
}

function renderPage(hostApi: FeatureHostApiV1) {
  return render(
    <FeatureHostApiProvider value={hostApi}>
      <AgentHubPage {...pageProps} />
    </FeatureHostApiProvider>
  )
}

describe('AgentHubPage', () => {
  it('resolves the default installed/Bibit/skill query and renders a card with pagination', async () => {
    const { hostApi, calls } = makeStoreHost()
    renderPage(hostApi)

    await screen.findByRole('heading', { name: 'code-review' })

    expect(document.querySelector('.agent-hub__grid')).toBeTruthy()
    expect(document.querySelector('.power-pagination')).toBeTruthy()

    expect(calls).toHaveLength(1)
    expect(calls[0].params).toEqual({
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      tags: [],
      page: 1,
      pageSize: 20,
    })
    expect(screen.getByRole('heading', { name: 'code-review' })).toBeTruthy()
    expect((screen.getByRole('spinbutton', { name: 'Page number' }) as HTMLInputElement).value).toBe('1')
    expect(screen.getByText('/ 1 页')).toBeTruthy()
  })

  it('shows the capability-unavailable error and recovers when Retry re-reads the capability', async () => {
    const user = userEvent.setup()
    let available = false
    const calls: StoreRequest[] = []
    const service: FeatureServiceApiV1<'store'> = {
      async request<TResult>(input: StoreRequest): Promise<TResult> {
        calls.push(input)
        return readyResult() as TResult
      },
    }
    const hostApi: FeatureHostApiV1 = {
      sdkApiVersion: 1,
      featureId: 'agent-hub',
      grantedCapabilities: ['service:store'],
      getCapability: (capability) =>
        (available && (capability as FeatureHostCapability) === 'service:store' ? service : undefined) as never,
    }
    renderPage(hostApi)

    expect(await screen.findByText('Store capability is not available.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()

    available = true
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByRole('heading', { name: 'code-review' })
  })

  it('shows Loading Powers… then the empty copy when the result has no items', async () => {
    let resolveEmpty!: (value: ReadyListPowersResult) => void
    const { hostApi } = makeStoreHost(
      () => new Promise<ReadyListPowersResult>((resolve) => (resolveEmpty = resolve))
    )
    renderPage(hostApi)

    expect(screen.getByText('Loading Powers…')).toBeTruthy()

    resolveEmpty(readyResult({ items: [], total: 0 }))

    expect(await screen.findByText('No Powers are available.')).toBeTruthy()
  })

  it('omits the agent and hides Agent controls when switching to the market', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost()
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Power 市场' }))
    await screen.findByRole('heading', { name: 'code-review' })

    expect(calls).toHaveLength(2)
    expect(calls[1].params).toEqual({
      scope: 'market',
      type: 'skill',
      tags: [],
      page: 1,
      pageSize: 20,
    })
    expect('agent' in calls[1].params).toBe(false)
    expect(screen.queryByRole('group', { name: 'Agent' })).toBeNull()
  })

  it('resets the page to 1 when selecting another installed Agent', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      const params = paramsOf(input)
      return readyResult({
        page: params.page,
        total: 40,
        nextPage: params.page === 1 ? 2 : undefined,
        items: [params.page === 2 ? secondPageSkill : codeReview],
      })
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'second-page' })

    await user.hover(screen.getByRole('button', { name: '我的 Power' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'codex' }))

    await waitFor(() => {
      const last = calls[calls.length - 1]
      expect(paramsOf(last).agent).toBe('codex')
      expect(paramsOf(last).page).toBe(1)
      expect('snapshot' in paramsOf(last)).toBe(false)
    })
    await screen.findByRole('heading', { name: 'code-review' })
  })

  it('jumps directly with the current snapshot', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      const params = paramsOf(input)
      return readyResult({
        page: params.page,
        total: 80,
        nextPage: params.page < 4 ? params.page + 1 : undefined,
        items: [params.page === 3 ? secondPageSkill : codeReview],
      })
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    const pageInput = screen.getByRole('spinbutton', { name: 'Page number' })
    await user.clear(pageInput)
    await user.type(pageInput, '3{Enter}')
    await screen.findByRole('heading', { name: 'second-page' })

    const last = paramsOf(calls[calls.length - 1])
    expect(last.page).toBe(3)
    expect(last.snapshot).toBe('snap-1')
  })

  it('retains the selected installed Agent after visiting the market', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost()
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.hover(screen.getByRole('button', { name: '我的 Power' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'codex' }))
    await waitFor(() => expect(paramsOf(calls[calls.length - 1]).agent).toBe('codex'))

    await user.click(screen.getByRole('button', { name: 'Power 市场' }))
    await waitFor(() => expect(paramsOf(calls[calls.length - 1]).scope).toBe('market'))

    await user.click(screen.getByRole('button', { name: '我的 Power' }))
    await waitFor(() => {
      const last = paramsOf(calls[calls.length - 1])
      expect(last.scope).toBe('installed')
      expect(last.agent).toBe('codex')
    })
  })

  it('clears tags and resets the page when selecting the plugin type', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      const params = paramsOf(input)
      return readyResult({
        page: params.page,
        total: 40,
        nextPage: params.page === 1 ? 2 : undefined,
        facets: { agents: [], tags: ['alpha'] },
        items: [params.type === 'plugin' ? pluginSeries : params.page === 2 ? secondPageSkill : codeReview],
      })
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'alpha' }))
    await waitFor(() => expect(paramsOf(calls[calls.length - 1]).tags).toEqual(['alpha']))

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'second-page' })

    await user.click(screen.getByRole('button', { name: 'plugin' }))

    await waitFor(() => {
      const last = paramsOf(calls[calls.length - 1])
      expect(last.type).toBe('plugin')
      expect(last.tags).toEqual([])
      expect(last.page).toBe(1)
      expect('snapshot' in last).toBe(false)
    })
    await screen.findByRole('heading', { name: 'scan-guard' })
  })

  it('sends sorted OR tags when multiple tags are selected', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost(() =>
      readyResult({ facets: { agents: [], tags: ['alpha', 'beta', 'gamma'] } })
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'beta' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'alpha' }))

    await waitFor(() => expect(paramsOf(calls[calls.length - 1]).tags).toEqual(['alpha', 'beta']))
  })

  it('sends page 2 with the current snapshot when Next is pressed', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      const params = paramsOf(input)
      return readyResult({
        page: params.page,
        total: 40,
        nextPage: params.page === 1 ? 2 : undefined,
        items: [params.page === 2 ? secondPageSkill : codeReview],
      })
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'second-page' })

    await waitFor(() => {
      const last = paramsOf(calls[calls.length - 1])
      expect(last.page).toBe(2)
      expect(last.snapshot).toBe('snap-1')
    })
  })

  it('triggers a fresh page 1 request without a snapshot on reset_required', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      const params = paramsOf(input)
      if (params.page === 2) return { status: 'reset_required', reason: 'snapshot_changed' }
      return readyResult({ total: 40, nextPage: 2 })
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => {
      const last = paramsOf(calls[calls.length - 1])
      expect(last.page).toBe(1)
      expect('snapshot' in last).toBe(false)
    })
    await screen.findByRole('heading', { name: 'code-review' })
  })

  it('treats page-1 reset_required as an incompatible service error', async () => {
    const { hostApi } = makeStoreHost(() => ({
      status: 'reset_required',
      reason: 'snapshot_changed',
    }))
    renderPage(hostApi)

    expect(
      await screen.findByText('Power catalog service is incompatible with this plugin.')
    ).toBeTruthy()
    expect(screen.queryByText('Loading Powers…')).toBeNull()
  })

  it('renders warnings alongside valid cards', async () => {
    const { hostApi } = makeStoreHost(() =>
      readyResult({
        warnings: [
          {
            code: 'installed-agent-unavailable',
            agent: 'nova',
            message: 'Some installed Powers for this agent are temporarily unavailable.',
          },
        ],
      })
    )
    renderPage(hostApi)

    await screen.findByRole('heading', { name: 'code-review' })
    expect(
      screen.getByText('Some installed Powers for this agent are temporarily unavailable.')
    ).toBeTruthy()
  })

  it.each([
    ['offline', 'Power catalog is offline.', true],
    ['timeout', 'Power catalog request timed out.', true],
    ['unauthorized', 'Power catalog authorization is required.', false],
    ['incompatible', 'Power catalog service is incompatible with this plugin.', false],
    ['unavailable', 'Power catalog is unavailable.', true],
    ['unknown', 'Could not load Power catalog.', false],
  ] as const)('maps the %s error to its safe message', async (code, message, retryable) => {
    const { hostApi } = makeStoreHost(() => {
      throw { version: 1, code, message: 'raw host message' } as FeatureServiceErrorV1
    })
    renderPage(hostApi)

    expect(await screen.findByText(message)).toBeTruthy()
    const retry = screen.queryByRole('button', { name: 'Retry' })
    if (retryable) expect(retry).toBeTruthy()
    else expect(retry).toBeNull()
  })

  it('rejects a prototype-key error code and shows the safe fallback', async () => {
    const { hostApi } = makeStoreHost(() => {
      throw { version: 1, code: 'constructor', message: 'x' }
    })
    renderPage(hostApi)

    expect(
      await screen.findByText('Power catalog service is incompatible with this plugin.')
    ).toBeTruthy()
    expect(screen.queryByText(/function/i)).toBeNull()
  })

  it('maps a dev-host apm-unavailable Error to a retryable unavailable message', async () => {
    const { hostApi } = makeStoreHost(() => {
      throw new Error('apm CLI is unavailable')
    })
    renderPage(hostApi)

    expect(
      await screen.findByText('Power catalog is unavailable: the apm CLI could not be started.')
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('maps a dev-host unreachable Error to a retryable unavailable message', async () => {
    const { hostApi } = makeStoreHost(() => {
      throw new Error('External service is unavailable')
    })
    renderPage(hostApi)

    expect(await screen.findByText('Power catalog is unavailable.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('appends the diagnostic ID when the mapped error carries one', async () => {
    const { hostApi } = makeStoreHost(() => {
      throw {
        version: 1,
        code: 'timeout',
        message: 'raw host message',
        diagnosticId: 'diag-42',
      } as FeatureServiceErrorV1
    })
    renderPage(hostApi)

    expect(
      await screen.findByText('Power catalog request timed out. Diagnostic ID: diag-42')
    ).toBeTruthy()
  })

  it('aborts the active request when the page unmounts', async () => {
    let capturedSignal: AbortSignal | undefined
    const { hostApi } = makeStoreHost((input) => {
      capturedSignal = input.signal
      return new Promise(() => {})
    })
    const view = renderPage(hostApi)

    await waitFor(() => expect(capturedSignal).toBeDefined())
    view.unmount()

    expect(capturedSignal!.aborted).toBe(true)
  })

  it('never lets a late older response replace a newer filter response', async () => {
    const user = userEvent.setup()
    const resolvers: Array<(value: ReadyListPowersResult) => void> = []
    const { hostApi, calls } = makeStoreHost(
      () => new Promise<ReadyListPowersResult>((resolve) => resolvers.push(resolve))
    )
    renderPage(hostApi)

    await waitFor(() => expect(calls).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Power 市场' }))
    await waitFor(() => expect(calls).toHaveLength(2))

    resolvers[1](readyResult({ items: [marketSeries], facets: { agents: [], tags: [] } }))
    await screen.findByRole('heading', { name: 'market-translate' })

    resolvers[0](readyResult({ items: [staleSeries] }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'stale-skill' })).toBeNull())
    expect(screen.getByRole('heading', { name: 'market-translate' })).toBeTruthy()
  })

  it('renders the fixed installed Agent menu with bibit, codex, and claude-code', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost(() => readyResult({ items: [], total: 0 }))
    renderPage(hostApi)
    await screen.findByText('No Powers are available.')

    await user.hover(screen.getByRole('button', { name: '我的 Power' }))

    expect(screen.getByRole('menuitemradio', { name: 'bibit' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'codex' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'claude-code' })).toBeTruthy()
  })
})
