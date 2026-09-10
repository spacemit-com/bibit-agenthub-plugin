import { useEffect, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { AgentHubPage } from './AgentHubPage'
import { withAgentHubI18n } from './agentHubI18n'

afterEach(cleanup)

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
    }
  }
})

type StoreRequest = FeatureServiceRequestV1<'store'>

type WireParams = { scope: string; agent?: string; knownSnapshot?: string }

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const codeReviewRecord = {
  agent: 'bibit',
  type: 'skill',
  name: 'code-review',
  version: 'v1.0.0',
  description: 'Peer review workflow.',
  tags: ['quality'],
}

const codeReviewList = JSON.stringify([codeReviewRecord])

function installedData(listJson: string) {
  return { scope: 'installed', status: 'data', listJson }
}

function installedPage(count: number, agent = 'bibit'): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, index) => ({
      agent,
      type: 'skill',
      name: `skill-${String(index).padStart(2, '0')}`,
      version: 'v1.0.0',
      description: '',
      tags: [],
    }))
  )
}

function marketCatalog(count: number, changed = false): string {
  const items = Array.from({ length: count }, (_, index) => ({
    name: `market-${String(index).padStart(2, '0')}`,
    version: 'v1.0.0',
    description: '',
    tags: [],
  }))
  return JSON.stringify(changed ? { _changed: true, skills: { items } } : { skills: { items } })
}

const marketCatalogJson = JSON.stringify({
  skills: {
    items: [{ name: 'market-translate', version: 'v1.0.0', description: 'Translates text.', tags: [] }],
  },
})

let marketSnapshotPromise: Promise<string> | undefined
function marketSnapshot(): Promise<string> {
  marketSnapshotPromise ??= sha256(marketCatalogJson)
  return marketSnapshotPromise
}

async function marketData() {
  return {
    scope: 'market',
    status: 'data',
    snapshot: await marketSnapshot(),
    catalogJson: marketCatalogJson,
  }
}

function wireParamsOf(call: StoreRequest): WireParams {
  return call.params as WireParams
}

function makeStoreHost(respond?: (input: StoreRequest) => unknown): {
  hostApi: FeatureHostApiV1
  calls: StoreRequest[]
} {
  const calls: StoreRequest[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: StoreRequest): Promise<TResult> {
      calls.push(input)
      if (respond) return (await respond(input)) as TResult
      return installedData(codeReviewList) as TResult
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

// The production module wraps the page in the translation provider, so the
// language tests exercise the same component identity across rerenders.
const LocalizedAgentHubPage = withAgentHubI18n(AgentHubPage)

function renderLocalizedPage(hostApi: FeatureHostApiV1, language?: string) {
  return render(
    <FeatureHostApiProvider value={hostApi}>
      <LocalizedAgentHubPage {...pageProps} language={language} />
    </FeatureHostApiProvider>
  )
}

function rerenderLocalizedPage(
  view: ReturnType<typeof render>,
  hostApi: FeatureHostApiV1,
  language: string
) {
  view.rerender(
    <FeatureHostApiProvider value={hostApi}>
      <LocalizedAgentHubPage {...pageProps} language={language} />
    </FeatureHostApiProvider>
  )
}

function pageNumber(): string {
  return (screen.getByRole('spinbutton', { name: 'Page number' }) as HTMLInputElement).value
}

describe('AgentHubPage', () => {
  it('resolves the default installed query as a raw wire request and renders a card', async () => {
    const { hostApi, calls } = makeStoreHost()
    renderPage(hostApi)

    await screen.findByRole('heading', { name: 'code-review' })

    expect(document.querySelector('.agent-hub__grid')).toBeTruthy()
    expect(document.querySelector('.power-pagination')).toBeTruthy()
    expect(calls).toHaveLength(1)
    expect(wireParamsOf(calls[0])).toEqual({ scope: 'installed', agent: 'bibit' })
    expect(pageNumber()).toBe('1')
    expect(screen.getByText('of 1')).toBeTruthy()
  })

  it('shows the capability-unavailable error and recovers when Retry re-reads the capability', async () => {
    const user = userEvent.setup()
    let available = false
    const calls: StoreRequest[] = []
    const service: FeatureServiceApiV1<'store'> = {
      async request<TResult>(input: StoreRequest): Promise<TResult> {
        calls.push(input)
        return installedData(codeReviewList) as TResult
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
    let resolveEmpty!: (value: unknown) => void
    const { hostApi } = makeStoreHost(() => new Promise((resolve) => (resolveEmpty = resolve)))
    renderPage(hostApi)

    expect(screen.getByText('Loading Powers…')).toBeTruthy()

    resolveEmpty(installedData('[]'))

    expect(await screen.findByText('No Powers are available.')).toBeTruthy()
  })

  it('omits the agent and hides Agent controls when switching to the market', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      const params = wireParamsOf(input)
      return params.scope === 'market' ? marketData() : installedData(codeReviewList)
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Power market' }))
    await screen.findByRole('heading', { name: 'market-translate' })

    expect(calls).toHaveLength(2)
    expect(wireParamsOf(calls[1])).toEqual({ scope: 'market' })
    expect('agent' in wireParamsOf(calls[1])).toBe(false)
    expect(screen.queryByRole('group', { name: 'Agent' })).toBeNull()
  })

  it('resets the page to 1 when selecting another installed Agent', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      const params = wireParamsOf(input)
      return installedData(installedPage(25, params.agent ?? 'bibit'))
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'skill-00' })

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'skill-20' })
    expect(pageNumber()).toBe('2')

    await user.hover(screen.getByRole('button', { name: 'My Powers' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'codex' }))

    await waitFor(() => {
      expect(wireParamsOf(calls[calls.length - 1]).agent).toBe('codex')
      expect(pageNumber()).toBe('1')
    })
    await screen.findByRole('heading', { name: 'skill-00' })
  })

  it('jumps directly to a page number', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost(() => installedData(installedPage(45)))
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'skill-00' })

    const pageInput = screen.getByRole('spinbutton', { name: 'Page number' })
    await user.clear(pageInput)
    await user.type(pageInput, '3{Enter}')
    await screen.findByRole('heading', { name: 'skill-40' })

    expect(pageNumber()).toBe('3')
  })

  it('retains the selected installed Agent after visiting the market', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      const params = wireParamsOf(input)
      return params.scope === 'market' ? marketData() : installedData(codeReviewList)
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.hover(screen.getByRole('button', { name: 'My Powers' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'codex' }))
    await waitFor(() => expect(wireParamsOf(calls[calls.length - 1]).agent).toBe('codex'))

    await user.click(screen.getByRole('button', { name: 'Power market' }))
    await waitFor(() => expect(wireParamsOf(calls[calls.length - 1]).scope).toBe('market'))

    await user.click(screen.getByRole('button', { name: 'My Powers' }))
    await waitFor(() => {
      const last = wireParamsOf(calls[calls.length - 1])
      expect(last.scope).toBe('installed')
      expect(last.agent).toBe('codex')
    })
  })

  it('clears tags and resets the page when selecting the plugin type', async () => {
    const user = userEvent.setup()
    const list = JSON.stringify([
      ...Array.from({ length: 25 }, (_, index) => ({
        agent: 'bibit',
        type: 'skill',
        name: `skill-${String(index).padStart(2, '0')}`,
        version: 'v1.0.0',
        description: '',
        tags: ['alpha'],
      })),
      { agent: 'bibit', type: 'plugin', name: 'scan-guard', version: 'v1.0.0', description: '', tags: [] },
    ])
    const { hostApi } = makeStoreHost(() => installedData(list))
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'skill-00' })

    await user.click(screen.getByRole('button', { name: 'alpha' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'alpha' }).getAttribute('aria-pressed')).toBe('true')
    )

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'skill-20' })

    await user.click(screen.getByRole('button', { name: 'plugin' }))
    await screen.findByRole('heading', { name: 'scan-guard' })

    expect(pageNumber()).toBe('1')
    expect(screen.getByRole('button', { name: 'plugin' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('selects tags in sorted OR order', async () => {
    const user = userEvent.setup()
    const list = JSON.stringify([
      {
        agent: 'bibit',
        type: 'skill',
        name: 'code-review',
        version: 'v1.0.0',
        description: '',
        tags: ['alpha', 'beta', 'gamma'],
      },
    ])
    const { hostApi } = makeStoreHost(() => installedData(list))
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'beta' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'beta' }).getAttribute('aria-pressed')).toBe('true')
    )
    await user.click(screen.getByRole('button', { name: 'alpha' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'alpha' }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: 'beta' }).getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('resets to page 1 and drops the snapshot on reset_required', async () => {
    const user = userEvent.setup()
    const snapshotA = await sha256(marketCatalog(25))
    const catalogB = marketCatalog(25, true)
    const snapshotB = await sha256(catalogB)
    const { hostApi } = makeStoreHost((input) => {
      const params = wireParamsOf(input)
      if (params.scope === 'installed') return installedData(codeReviewList)
      if (params.knownSnapshot === snapshotA) {
        return { scope: 'market', status: 'data', snapshot: snapshotB, catalogJson: catalogB }
      }
      return { scope: 'market', status: 'data', snapshot: snapshotA, catalogJson: marketCatalog(25) }
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Power market' }))
    await screen.findByRole('heading', { name: 'market-00' })

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(pageNumber()).toBe('1'))
    await screen.findByRole('heading', { name: 'market-00' })
  })

  it('maps an invalid wire response to the incompatible fallback', async () => {
    const { hostApi } = makeStoreHost(() => ({ status: 'reset_required', reason: 'snapshot_changed' }))
    renderPage(hostApi)

    expect(
      await screen.findByText('Power catalog service is incompatible with this plugin.')
    ).toBeTruthy()
    expect(screen.queryByText('Loading Powers…')).toBeNull()
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

  it('maps a dev-host apc-unavailable Error to a retryable unavailable message', async () => {
    const { hostApi } = makeStoreHost(() => {
      throw new Error('APC catalog is unavailable')
    })
    renderPage(hostApi)

    expect(
      await screen.findByText('Power catalog is unavailable: the APC catalog could not be loaded.')
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

    expect(await screen.findByText('Power catalog request timed out.')).toBeTruthy()
    // The host id is rendered as its own sentence, never concatenated into the
    // mapped message, so the message stays a translatable dictionary entry.
    expect(screen.getByText('Diagnostic ID: diag-42')).toBeTruthy()
  })

  it('switches every page surface with the host language prop', async () => {
    const { hostApi } = makeStoreHost((input) =>
      installedData(wireParamsOf(input).scope === 'installed' ? codeReviewList : '[]')
    )
    const view = renderLocalizedPage(hostApi, 'en')

    await screen.findByRole('heading', { name: 'code-review' })
    expect(screen.getByText('INTERNAL CATALOG')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'My Powers' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Power market' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'Page number' })).toBeTruthy()
    expect(screen.getByText('of 1')).toBeTruthy()

    rerenderLocalizedPage(view, hostApi, 'zh-CN')

    expect(screen.getByText('内部目录')).toBeTruthy()
    expect(screen.getByRole('button', { name: '我的 Power' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Power 市场' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: '页码' })).toBeTruthy()
    expect(screen.getByText('/ 1 页')).toBeTruthy()
    expect(screen.queryByText('INTERNAL CATALOG')).toBeNull()
  })

  it('keeps the loaded market view and the open dialog across a language change', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.list.v1') {
        return wireParamsOf(input).scope === 'market' ? marketData() : installedData('[]')
      }
      if (input.operationId === 'powers.inspect.v1') return { listJson: '[]' }
      throw new Error('unexpected op ' + input.operationId)
    })
    const view = renderLocalizedPage(hostApi, 'en')

    await user.click(screen.getByRole('button', { name: 'Power market' }))
    await screen.findByRole('heading', { name: 'market-translate' })
    await user.click(screen.getByRole('heading', { name: 'market-translate' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    await dialog.findByText('Not installed')

    const listCalls = () => calls.filter((call) => call.operationId === 'powers.list.v1').length
    const before = listCalls()

    rerenderLocalizedPage(view, hostApi, 'zh-CN')

    expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true)
    expect(await dialog.findByText('未安装')).toBeTruthy()
    expect(dialog.getByRole('button', { name: '安装' })).toBeTruthy()
    await waitFor(() => expect(listCalls()).toBe(before))
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
    const resolvers: Array<(value: unknown) => void> = []
    const { hostApi, calls } = makeStoreHost(() => new Promise((resolve) => resolvers.push(resolve)))
    renderPage(hostApi)

    await waitFor(() => expect(calls).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Power market' }))
    await waitFor(() => expect(calls).toHaveLength(2))

    resolvers[1](await marketData())
    await screen.findByRole('heading', { name: 'market-translate' })

    resolvers[0](installedData(codeReviewList))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'code-review' })).toBeNull())
    expect(screen.getByRole('heading', { name: 'market-translate' })).toBeTruthy()
  })

  it('renders the fixed Agent menu and loads Hermes when selected', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((params) => installedData(
      wireParamsOf(params).agent === 'hermes-agent' ? JSON.stringify([{ ...codeReviewRecord, agent: 'hermes-agent' }]) : '[]'
    ))
    renderPage(hostApi)
    await screen.findByText('No Powers are available.')

    await user.hover(screen.getByRole('button', { name: 'My Powers' }))

    expect(screen.getByRole('menuitemradio', { name: 'bibit' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'codex' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'claude-code' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'hermes-agent' }))
    await screen.findByRole('heading', { name: 'code-review' })
    expect(calls.at(-1)?.params).toEqual({ scope: 'installed', agent: 'hermes-agent' })
  })

  it('does not restart the in-flight request when the host recreates the store object on re-render', async () => {
    const user = userEvent.setup()
    let marketRequests = 0
    let bump: (() => void) | undefined

    function Shell() {
      const [, setTick] = useState(0)
      useEffect(() => {
        bump = () => setTick((value) => value + 1)
      }, [])
      const service: FeatureServiceApiV1<'store'> = {
        async request<TResult>(input: StoreRequest): Promise<TResult> {
          const params = wireParamsOf(input)
          if (params.scope === 'market') {
            marketRequests += 1
            if (marketRequests === 1) setTimeout(() => bump?.(), 5)
            await new Promise((resolve) => setTimeout(resolve, 30))
            return (await marketData()) as TResult
          }
          return installedData(codeReviewList) as TResult
        },
      }
      const hostApi: FeatureHostApiV1 = {
        sdkApiVersion: 1,
        featureId: 'agent-hub',
        grantedCapabilities: ['service:store'],
        getCapability: (capability) =>
          (capability as FeatureHostCapability) === 'service:store' ? (service as never) : undefined,
      }
      return (
        <FeatureHostApiProvider value={hostApi}>
          <AgentHubPage {...pageProps} />
        </FeatureHostApiProvider>
      )
    }

    render(<Shell />)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Power market' }))
    await screen.findByRole('heading', { name: 'market-translate' })

    // A host re-render mid-request must not abort and re-issue the market read.
    expect(marketRequests).toBe(1)
  })

  describe('power details and installation', () => {
    const twoVersionMarketJson = JSON.stringify({
      skills: {
        items: [
          { name: 'market-translate', version: 'v2.0.0', description: 'Translates v2.', tags: ['modern'] },
          { name: 'market-translate', version: 'v1.0.0', description: 'Translates v1.', tags: ['classic'] },
        ],
      },
    })

    function twoVersionMarketData() {
      return sha256(twoVersionMarketJson).then((snapshot) => ({
        scope: 'market',
        status: 'data',
        snapshot,
        catalogJson: twoVersionMarketJson,
      }))
    }

    it('shares the selected version between the card and the details dialog', async () => {
      const user = userEvent.setup()
      const { hostApi } = makeStoreHost((input) => {
        const params = wireParamsOf(input)
        if (input.operationId === 'powers.list.v1') {
          return params.scope === 'market' ? twoVersionMarketData() : installedData('[]')
        }
        if (input.operationId === 'powers.inspect.v1') return { listJson: '[]' }
        if (input.operationId === 'powers.install.v1' || input.operationId === 'powers.uninstall.v1') {
          return { status: 'exited', exitCode: 0 }
        }
        throw new Error('unexpected op ' + input.operationId)
      })
      renderPage(hostApi)
      await user.click(screen.getByRole('button', { name: 'Power market' }))
      await screen.findByRole('heading', { name: 'market-translate' })

      await user.selectOptions(screen.getByLabelText('Version'), 'v1.0.0')
      expect(screen.getByText('Translates v1.')).toBeTruthy()

      await user.click(screen.getByRole('heading', { name: 'market-translate' }))
      const dialog = within(document.querySelector('dialog') as HTMLElement)
      expect(dialog.getByText('Translates v1.')).toBeTruthy()
      expect((dialog.getByLabelText('Version') as HTMLSelectElement).value).toBe('v1.0.0')

      await user.selectOptions(dialog.getByLabelText('Version'), 'v2.0.0')
      await user.click(dialog.getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(screen.getByText('Translates v2.')).toBeTruthy())
    })

    it('installs the selected version from the market details dialog', async () => {
      const user = userEvent.setup()
      let installed: unknown[] = []
      let installCall: StoreRequest | undefined
      const { hostApi } = makeStoreHost((input) => {
        const params = wireParamsOf(input)
        if (input.operationId === 'powers.list.v1') {
          return params.scope === 'market' ? marketData() : installedData(JSON.stringify(installed))
        }
        if (input.operationId === 'powers.inspect.v1') return { listJson: JSON.stringify(installed) }
        if (input.operationId === 'powers.install.v1') {
          installCall = input
          installed = [{ agent: 'bibit', type: 'skill', name: 'market-translate', version: 'v1.0.0', description: '', tags: [] }]
          return { status: 'exited', exitCode: 0 }
        }
        if (input.operationId === 'powers.uninstall.v1') return { status: 'exited', exitCode: 0 }
        throw new Error('unexpected op ' + input.operationId)
      })
      renderPage(hostApi)
      await user.click(screen.getByRole('button', { name: 'Power market' }))
      await screen.findByRole('heading', { name: 'market-translate' })

      await user.click(screen.getByRole('heading', { name: 'market-translate' }))
      const dialog = within(document.querySelector('dialog') as HTMLElement)
      await dialog.findByText('Not installed')

      await user.click(dialog.getByRole('button', { name: 'Install' }))

      expect(await dialog.findByText('Installation complete.')).toBeTruthy()
      expect(installCall?.operationId).toBe('powers.install.v1')
      expect(installCall?.params).toEqual({
        agent: 'bibit',
        type: 'skill',
        name: 'market-translate',
        version: 'v1.0.0',
      })
    })

    it('uninstalls from the installed details dialog', async () => {
      const user = userEvent.setup()
      let installed: unknown[] = [codeReviewRecord]
      let uninstallCall: StoreRequest | undefined
      const { hostApi } = makeStoreHost((input) => {
        if (input.operationId === 'powers.list.v1') return installedData(JSON.stringify(installed))
        if (input.operationId === 'powers.inspect.v1') return { listJson: JSON.stringify(installed) }
        if (input.operationId === 'powers.install.v1') return { status: 'exited', exitCode: 0 }
        if (input.operationId === 'powers.uninstall.v1') {
          uninstallCall = input
          installed = []
          return { status: 'exited', exitCode: 0 }
        }
        throw new Error('unexpected op ' + input.operationId)
      })
      renderPage(hostApi)
      await screen.findByRole('heading', { name: 'code-review' })
      expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()

      await user.click(screen.getByRole('heading', { name: 'code-review' }))
      const dialog = within(document.querySelector('dialog') as HTMLElement)
      await dialog.findByText('Installed v1.0.0')

      await user.click(dialog.getByRole('button', { name: 'Uninstall' }))

      await waitFor(() => expect(uninstallCall?.operationId).toBe('powers.uninstall.v1'))
      expect(uninstallCall?.params).toEqual({ agent: 'bibit', type: 'skill', name: 'code-review' })
    })

    it('opens a read-only dialog from installed cards and a writable dialog from market cards', async () => {
      const user = userEvent.setup()
      const { hostApi } = makeStoreHost((input) => {
        const params = wireParamsOf(input)
        if (input.operationId === 'powers.list.v1') {
          return params.scope === 'market' ? marketData() : installedData(codeReviewList)
        }
        if (input.operationId === 'powers.inspect.v1') {
          const name = (input.params as { name?: string }).name
          return { listJson: name === 'code-review' ? codeReviewList : '[]' }
        }
        if (input.operationId === 'powers.install.v1' || input.operationId === 'powers.uninstall.v1') {
          return { status: 'exited', exitCode: 0 }
        }
        throw new Error('unexpected op ' + input.operationId)
      })
      renderPage(hostApi)
      await screen.findByRole('heading', { name: 'code-review' })
      expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()

      await user.click(screen.getByRole('heading', { name: 'code-review' }))
      let dialog = within(document.querySelector('dialog') as HTMLElement)
      expect(await dialog.findByRole('button', { name: 'Uninstall' })).toBeTruthy()
      expect((dialog.getByLabelText('Version') as HTMLSelectElement).disabled).toBe(true)
      expect((dialog.getByLabelText('Agent') as HTMLSelectElement).disabled).toBe(true)
      await user.click(dialog.getByRole('button', { name: 'Close' }))

      await user.click(screen.getByRole('button', { name: 'Power market' }))
      await screen.findByRole('heading', { name: 'market-translate' })
      expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()

      await user.click(screen.getByRole('heading', { name: 'market-translate' }))
      dialog = within(document.querySelector('dialog') as HTMLElement)
      expect(await dialog.findByRole('button', { name: 'Install' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
      expect((dialog.getByLabelText('Version') as HTMLSelectElement).disabled).toBe(false)
    })
  })
})
