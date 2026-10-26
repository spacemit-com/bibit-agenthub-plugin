import { useEffect, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  FeatureHostApiProvider,
  type FeatureHostActionApiV1,
  type FeatureServiceApiV1,
  type FeatureServiceErrorV1,
  type FeatureServiceRequestV1,
  type FeatureHostApiV1,
  type FeatureHostCapabilityApiV1,
  type FeaturePageProps,
} from '@bibit/feature-sdk'
import type {
  FeatureHostActionRegistryV1,
  FeatureHostActionResultV1,
  FeatureHostCapability,
} from '@bibit/feature-contracts'
import { AgentHubPage } from './AgentHubPage'
import { withAgentHubI18n } from './agentHubI18n'
import {
  ACTIONS_UNAVAILABLE_TEXT,
  COMPOSE_RETRY_HINT,
  COMPOSE_UNSUPPORTED_TEXT,
  CREATE_RESOURCE_ACTION,
  CREATE_RESOURCE_PROMPT_LINES,
} from './api/conversationCompose'

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

async function chooseTag(user: ReturnType<typeof userEvent.setup>, name: string) {
  const trigger = screen.getByRole('button', { name: 'Tags' })
  if (trigger.getAttribute('aria-expanded') !== 'true') await user.click(trigger)
  await user.click(screen.getByRole('checkbox', { name }))
}

function selectedTagLabel(): string {
  return screen.getByRole('button', { name: 'Tags' }).textContent ?? ''
}

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

/**
 * An install manifest that already has one of the market catalog's Powers, used by
 * the market-badge cases. `market-translate` is the skill the market fixture lists.
 */
const installedManifest = JSON.stringify([
  codeReviewRecord,
  { ...codeReviewRecord, name: 'market-translate' },
])

function installedData(listJson: string) {
  return { scope: 'installed', status: 'data', listJson }
}

/**
 * The custom-resource scan the installed view always performs alongside the APM
 * manifest read. Tests that do not care about custom resources answer with an
 * empty scan; a test that does care overrides it explicitly.
 */
function customData(itemsJson = '{"items":[],"skipped":[]}') {
  return { scope: 'custom', status: 'data', itemsJson }
}

/**
 * The `settings.get.v2` view. Only the Settings tab reads it, so a test that
 * never opens that tab never needs this answer.
 */
function settingsData(keys: { id: string; preview: string; enabled: boolean }[] = []) {
  return { showExperimental: false, refreshMinutes: 15, keys }
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

// A v2 market catalog: the display fields live on the record, and the source
// `description`/`name` stay the fallback an English host renders.
const localizedCatalogJson = JSON.stringify({
  skills: {
    items: [
      {
        name: 'market-translate',
        version: 'v1.0.0',
        description: 'Translates text.',
        tags: [],
        schema_version: 2,
        name_zh: '翻译助手',
        name_en: 'Translator',
        description_zh: '翻译文本。',
      },
    ],
  },
})

const localizedInstalledList = JSON.stringify([
  {
    agent: 'bibit',
    type: 'skill',
    name: 'code-review',
    version: 'v1.0.0',
    description: 'Peer review workflow.',
    tags: ['quality'],
    name_zh: '代码审查',
    name_en: 'Code Review',
    description_zh: '代码审查工作流。',
  },
])

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

type ComposeCall = {
  action: keyof FeatureHostActionRegistryV1
  input: FeatureHostActionRegistryV1[keyof FeatureHostActionRegistryV1]['input']
}

/**
 * `conversation.compose` spy. The default answer is `completed`, which is what
 * the host reports right before it navigates to the new session.
 */
function makeComposeActions(
  respond?: (
    call: ComposeCall
  ) => FeatureHostActionResultV1 | Promise<FeatureHostActionResultV1>
): {
  actions: FeatureHostActionApiV1
  calls: ComposeCall[]
} {
  const calls: ComposeCall[] = []
  const actions: FeatureHostActionApiV1 = {
    async invoke(action, input) {
      calls.push({ action, input } as ComposeCall)
      return respond ? respond(calls[calls.length - 1]) : { status: 'completed' }
    },
  }
  return { actions, calls }
}

function makeStoreHost(
  respond?: (input: StoreRequest) => unknown,
  compose?: FeatureHostActionApiV1
): {
  hostApi: FeatureHostApiV1
  calls: StoreRequest[]
} {
  const calls: StoreRequest[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: StoreRequest): Promise<TResult> {
      calls.push(input)
      if (respond) return (await respond(input)) as TResult
      if (input.operationId === 'powers.custom.list.v1') return customData() as TResult
      return installedData(codeReviewList) as TResult
    },
  }
  function getCapability<K extends FeatureHostCapability>(
    capability: K
  ): FeatureHostCapabilityApiV1<K> | undefined {
    if ((capability as FeatureHostCapability) === 'service:store') {
      return service as unknown as FeatureHostCapabilityApiV1<K>
    }
    if ((capability as FeatureHostCapability) === 'host:actions' && compose) {
      return compose as unknown as FeatureHostCapabilityApiV1<K>
    }
    return undefined
  }
  const hostApi: FeatureHostApiV1 = {
    sdkApiVersion: 1,
    featureId: 'agent-hub',
    grantedCapabilities: compose ? ['service:store', 'host:actions'] : ['service:store'],
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
    expect(screen.queryByRole('navigation', { name: 'Power pages' })).toBeNull()
    // The installed view reads the APM manifest and scans for hand-installed
    // resources; only the manifest read carries the list wire envelope.
    const listCalls = calls.filter((call) => call.operationId === 'powers.list.v1')
    expect(listCalls).toHaveLength(1)
    expect(wireParamsOf(listCalls[0])).toEqual({ scope: 'installed', agent: 'bibit' })
    expect(calls.filter((call) => call.operationId === 'powers.custom.list.v1')).toHaveLength(1)
    expect(screen.queryByRole('spinbutton', { name: 'Page number' })).toBeNull()
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

  it('shows Loading Powers… then a copy naming the Agent that has nothing installed', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      return new Promise((resolve) => resolvers.push(resolve))
    })
    renderPage(hostApi)

    expect(screen.getByText('Loading Powers…')).toBeTruthy()

    resolvers[0](installedData('[]'))

    expect(await screen.findByText('No powers are installed for bibit.')).toBeTruthy()
  })

  it('names the tag filter when a tag selection empties the list', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      return installedData(
        JSON.stringify([
          { ...codeReviewRecord, tags: ['quality'] },
          { ...codeReviewRecord, name: 'other-skill', tags: ['writing'] },
        ])
      )
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    // The tags facet only offers tags that exist, and the filter is an intersection, so
    // selecting both tags matches no version -- the empty case under test.
    await chooseTag(user, 'quality')
    await chooseTag(user, 'writing')

    // The message names the tag filter, not the type: that is the filter that is
    // excluding everything, and the one the offered action clears.
    expect(await screen.findByText('No powers match these tags.')).toBeTruthy()
  })

  it('offers to clear the tags and restores the list when clicked', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      return installedData(
        JSON.stringify([
          { ...codeReviewRecord, tags: ['quality'] },
          { ...codeReviewRecord, name: 'other-skill', tags: ['writing'] },
        ])
      )
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await chooseTag(user, 'quality')
    await chooseTag(user, 'writing')
    await screen.findByText('No powers match these tags.')

    // The empty state carries the one action that fixes it, instead of telling the user
    // only that there is nothing to see.
    await user.click(screen.getByRole('button', { name: 'Tags' }))
    await user.click(screen.getByRole('button', { name: 'Clear tags' }))

    expect(await screen.findByRole('heading', { name: 'code-review' })).toBeTruthy()
    expect(screen.queryByText('No powers match these tags.')).toBeNull()
  })

  it('names the type filter when the type has nothing in the market', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      const params = wireParamsOf(input)
      // The catalog only carries skills, so the expert type legitimately has none.
      return params.scope === 'market' ? marketData() : installedData('[]')
    })
    renderPage(hostApi)
    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await screen.findByRole('heading', { name: 'market-translate' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'expert')

    expect(await screen.findByText('No expert powers in the catalog.')).toBeTruthy()
    // No extra action is needed: the type dropdown remains available.
    expect(screen.queryByRole('button', { name: 'Clear tags' })).toBeNull()
  })

  it('omits the agent and hides Agent controls when switching to the market', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      const params = wireParamsOf(input)
      return params.scope === 'market' ? marketData() : installedData(codeReviewList)
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await screen.findByRole('heading', { name: 'market-translate' })

    const marketCalls = calls.filter((call) => wireParamsOf(call).scope === 'market')
    expect(marketCalls).toHaveLength(1)
    expect(wireParamsOf(marketCalls[0])).toEqual({ scope: 'market' })
    expect('agent' in wireParamsOf(marketCalls[0])).toBe(false)
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

    await user.hover(screen.getByRole('button', { name: 'Agent: bibit' }))
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

  it('sizes the page scroller to the box the host gives it', async () => {
    const { hostApi } = makeStoreHost()
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    const scroller = document.querySelector('.agent-hub') as HTMLElement
    expect(scroller.style.height).toBe(`${window.innerHeight}px`)

    // jsdom has no layout, so stand in for a host box that starts partway down the window.
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      top: 40,
    } as unknown as DOMRect)
    fireEvent(window, new Event('resize'))

    expect(scroller.style.height).toBe(`${window.innerHeight - 40}px`)
  })

  it('gives every plugin scroller a thumb that measures that scroller', async () => {
    const { hostApi } = makeStoreHost()
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    // jsdom has no layout, so only the scroller whose metrics are declared reports overflow;
    // a thumb appearing there proves the ref points at that element and not at another one.
    const description = document.querySelector('.power-card__description') as HTMLElement
    for (const [property, value] of Object.entries({ clientHeight: 100, scrollHeight: 400 })) {
      Object.defineProperty(description, property, { configurable: true, value })
    }
    fireEvent(window, new Event('resize'))

    const descriptionThumb = description.querySelector(':scope > .agent-hub__scroll-thumb') as HTMLElement
    expect(descriptionThumb?.dataset.axis).toBe('y')
    expect(descriptionThumb?.style.height).toBe('25px')

    const tags = document.querySelector('.power-card__tags') as HTMLElement
    for (const [property, value] of Object.entries({ clientWidth: 100, scrollWidth: 400 })) {
      Object.defineProperty(tags, property, { configurable: true, value })
    }
    fireEvent(window, new Event('resize'))
    expect(tags.querySelector(':scope > .agent-hub__scroll-thumb')?.getAttribute('data-axis')).toBe('x')

    // The page and the filter row have no declared overflow, so they draw nothing.
    expect(document.querySelector('.agent-hub > .agent-hub__scroll-thumb')).toBeNull()
    expect(document.querySelectorAll('.agent-hub__scroll-thumb')).toHaveLength(2)
  })

  it('scrolls the page back to the top when the query changes', async () => {
    const user = userEvent.setup()
    const list = JSON.stringify([
      ...Array.from({ length: 25 }, (_, index) => ({
        agent: 'bibit',
        type: 'skill',
        name: `skill-${String(index).padStart(2, '0')}`,
        version: 'v1.0.0',
        description: '',
        tags: [],
      })),
      { agent: 'bibit', type: 'plugin', name: 'scan-guard', version: 'v1.0.0', description: '', tags: [] },
    ])
    const { hostApi } = makeStoreHost(() => installedData(list))
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'skill-00' })

    // The page owns its scroll container, so a new result set must not keep the offset.
    const scroller = document.querySelector('.agent-hub') as HTMLElement
    expect(scroller).toBeTruthy()

    scroller.scrollTop = 640
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'skill-20' })
    expect(scroller.scrollTop).toBe(0)

    scroller.scrollTop = 640
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'plugin')
    await screen.findByRole('heading', { name: 'scan-guard' })
    expect(scroller.scrollTop).toBe(0)
  })

  it('retains the selected installed Agent after visiting the market', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      const params = wireParamsOf(input)
      return params.scope === 'market' ? marketData() : installedData(codeReviewList)
    })
    // Per scope, not "the last call": the market preload also reads
    // `powers.list.v1` (with scope=installed) for the card badges, so the newest
    // call overall is not necessarily the one this test is asking about.
    const lastListParams = (scope: 'installed' | 'market') => {
      const listCalls = calls.filter(
        (call) =>
          call.operationId === 'powers.list.v1' && wireParamsOf(call).scope === scope
      )
      return wireParamsOf(listCalls[listCalls.length - 1])
    }
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.hover(screen.getByRole('button', { name: 'Agent: bibit' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'codex' }))
    await waitFor(() => expect(lastListParams('installed').agent).toBe('codex'))

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await waitFor(() => expect(lastListParams('market').scope).toBe('market'))

    await user.click(screen.getByRole('button', { name: 'My Capabilities' }))
    await waitFor(() => {
      const last = lastListParams('installed')
      expect(last.scope).toBe('installed')
      expect(last.agent).toBe('codex')
    })
  })

  it('installs a market Power to the Agent chosen in the tab-row control', async () => {
    const user = userEvent.setup()
    let installCall: StoreRequest | undefined
    const { hostApi } = makeStoreHost((input) => {
      const params = wireParamsOf(input)
      if (input.operationId === 'powers.list.v1') {
        return params.scope === 'market' ? marketData() : installedData('[]')
      }
      if (input.operationId === 'powers.custom.list.v1') return customData()
      if (input.operationId === 'powers.inspect.v1') return { listJson: '[]' }
      if (input.operationId === 'powers.install.v1') {
        installCall = input
        return { status: 'exited', exitCode: 0 }
      }
      throw new Error('unexpected op ' + input.operationId)
    })
    renderPage(hostApi)
    await screen.findByText('No powers are installed for bibit.')

    // Choosing an Agent no longer requires opening a dialog: the tab-row control
    // owns it, and the market install must follow the same choice.
    await user.hover(screen.getByRole('button', { name: 'Agent: bibit' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'codex' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent: codex' })).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await screen.findByRole('heading', { name: 'market-translate' })
    await user.click(screen.getByRole('heading', { name: 'market-translate' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    await dialog.findByText('Not installed')
    expect(dialog.getByTestId('dialog-agent-static').textContent).toBe('codex')

    await user.click(dialog.getByRole('button', { name: 'Install' }))

    await waitFor(() => expect(installCall?.operationId).toBe('powers.install.v1'))
    expect(installCall?.params).toEqual({
      agent: 'codex',
      type: 'skill',
      name: 'market-translate',
      version: 'v1.0.0',
    })
  })

  it('leaves the market query and its tags alone when the Agent changes', async () => {
    const user = userEvent.setup()
    const taggedCatalogJson = JSON.stringify({
      skills: {
        items: [
          { name: 'market-translate', version: 'v1.0.0', description: 'Translates text.', tags: ['alpha'] },
          { name: 'market-other', version: 'v1.0.0', description: 'Something else.', tags: ['beta'] },
        ],
      },
    })
    const snapshot = await sha256(taggedCatalogJson)
    const { hostApi, calls } = makeStoreHost((input) => {
      const params = wireParamsOf(input)
      if (input.operationId === 'powers.list.v1') {
        if (params.scope === 'market') {
          return { scope: 'market', status: 'data', snapshot, catalogJson: taggedCatalogJson }
        }
        return installedData('[]')
      }
      if (input.operationId === 'powers.custom.list.v1') return customData()
      throw new Error('unexpected op ' + input.operationId)
    })
    renderPage(hostApi)
    await screen.findByText('No powers are installed for bibit.')

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await screen.findByRole('heading', { name: 'market-translate' })
    await chooseTag(user, 'alpha')
    await waitFor(() =>
      expect(selectedTagLabel()).toContain('alpha')
    )

    const marketCalls = () =>
      calls.filter(
        (call) => call.operationId === 'powers.list.v1' && wireParamsOf(call).scope === 'market'
      ).length
    const before = marketCalls()

    await user.hover(screen.getByRole('button', { name: 'Agent: bibit' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'codex' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent: codex' })).toBeTruthy())
    // Give a stray refetch a chance to land before asserting none happened.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })

    // The market catalog is Agent-independent, so the choice only moves the
    // install target: the list and the tag filter must stay where they were.
    expect(marketCalls()).toBe(before)
    expect(selectedTagLabel()).toContain('alpha')
  })

  it('drops the expert type and moves the query off it when another Agent is chosen', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      // The record must carry the Agent that was asked for: records belonging to
      // another Agent are dropped, so a hard-coded `bibit` would make the codex
      // read look empty for a reason unrelated to the type filter.
      return installedData(JSON.stringify([{ ...codeReviewRecord, agent: wireParamsOf(input).agent ?? 'bibit' }]))
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    // Expert (the type) is bibit-only, so it is offered while bibit is the chosen Agent. The
    // type filter is applied client-side, so "the query moved off it" shows up as
    // the dropdown value and which cards survive, not as a wire parameter.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'expert')
    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).value).toBe('expert')
    )
    // The fixture is a skill, so it drops out under the expert filter.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'code-review' })).toBeNull())

    // Choosing another Agent removes the option, and the selection moves to a type
    // that Agent does take: staying on a hidden type would strand the list on
    // something the user can neither see nor switch away from.
    await user.hover(screen.getByRole('button', { name: 'Agent: bibit' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'codex' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Agent: codex' })).toBeTruthy()
      expect(screen.queryByRole('option', { name: 'expert' })).toBeNull()
      expect((screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).value).toBe('skill')
    })
    // The three types that Agent does take are all still offered, and the list
    // follows the fallback rather than staying on the hidden type.
    for (const label of ['skill', 'plugin', 'mcp']) {
      expect(screen.getByRole('option', { name: label })).toBeTruthy()
    }
    await screen.findByRole('heading', { name: 'code-review' })

    // Going back to bibit brings the type back. The menu is opened by clicking the
    // trigger here: the pointer is already on it from the step above, so `hover`
    // would not fire a second `mouseenter`.
    await user.click(screen.getByRole('button', { name: 'Agent: codex' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'bibit' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'expert' })).toBeTruthy())
  })

  it('preloads the manifest so market cards can show what is installed', async () => {
    const user = userEvent.setup()
    let installedReads = 0
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      const params = wireParamsOf(input)
      if (params.scope === 'market') return marketData()
      installedReads += 1
      // The first read is the installed tab's own list, which is empty; every later
      // one is the market preload. The badge below therefore cannot come from the
      // installed visit -- only from the preload.
      return installedData(installedReads === 1 ? '[]' : installedManifest)
    })
    renderPage(hostApi)
    await screen.findByText('No powers are installed for bibit.')
    expect(screen.queryByText('Installed')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await screen.findByRole('heading', { name: 'market-translate' })

    // Entering the market read the manifest again, and the card it covers is marked.
    await waitFor(() => expect(installedReads).toBeGreaterThan(1))
    await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
    expect(screen.getAllByText('Installed')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Add capability' })).toBeNull()

    // The badge came from the manifest preload, which must not leak into the market
    // wire request: the catalog is still read without an Agent.
    const marketCalls = calls.filter(
      (call) => call.operationId === 'powers.list.v1' && wireParamsOf(call).scope === 'market'
    )
    expect(marketCalls.length).toBeGreaterThan(0)
    expect('agent' in wireParamsOf(marketCalls[marketCalls.length - 1])).toBe(false)
  })

  it('re-reads the manifest for the new Agent when it changes on the market', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      const params = wireParamsOf(input)
      if (params.scope === 'market') return marketData()
      // bibit has the market Power; codex does not.
      return installedData(params.agent === 'bibit' ? installedManifest : '[]')
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await screen.findByRole('heading', { name: 'market-translate' })
    await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())

    await user.hover(screen.getByRole('button', { name: 'Agent: bibit' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'codex' }))

    await waitFor(() => {
      const reads = calls.filter(
        (call) =>
          call.operationId === 'powers.list.v1' &&
          wireParamsOf(call).scope === 'installed' &&
          wireParamsOf(call).agent === 'codex'
      )
      expect(reads.length).toBeGreaterThan(0)
      // The badge follows the new Agent's manifest, which has nothing installed.
      expect(screen.queryByText('Installed')).toBeNull()
    })
  })

  it('leaves the market usable when the manifest cannot be read', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      const params = wireParamsOf(input)
      if (params.scope === 'market') return marketData()
      throw Object.assign(new Error('apm is missing'), {
        version: 1,
        code: 'unavailable',
        retryable: true,
      })
    })
    renderPage(hostApi)
    // The installed tab cannot read it either, so it reports its own error.
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await screen.findByRole('heading', { name: 'market-translate' })

    // The badge is an addition to browsing: a manifest that cannot be read leaves
    // the cards unmarked rather than turning the market into an error.
    expect(screen.queryByText('Installed')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add capability' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('marks every installed card without offering another install', async () => {
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      return installedData(installedManifest)
    })
    renderPage(hostApi)

    // Installed state is visible at the start of each card's tag row.
    await screen.findByRole('heading', { name: 'code-review' })
    await screen.findByRole('heading', { name: 'market-translate' })
    expect(screen.getAllByText('Installed')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Add capability' })).toBeNull()
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

    await chooseTag(user, 'alpha')
    await waitFor(() =>
      expect(selectedTagLabel()).toContain('alpha')
    )

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'skill-20' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'plugin')
    await screen.findByRole('heading', { name: 'scan-guard' })

    expect(screen.queryByRole('navigation', { name: 'Power pages' })).toBeNull()
    expect((screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).value).toBe('plugin')
  })

  it('selects tags in sorted order and narrows the list', async () => {
    const user = userEvent.setup()
    const list = JSON.stringify([
      {
        agent: 'bibit',
        type: 'skill',
        name: 'both',
        version: 'v1.0.0',
        description: '',
        tags: ['alpha', 'beta'],
      },
      {
        agent: 'bibit',
        type: 'skill',
        name: 'alpha-only',
        version: 'v1.0.0',
        description: '',
        tags: ['alpha'],
      },
    ])
    const { hostApi } = makeStoreHost(() => installedData(list))
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'alpha-only' })
    await screen.findByRole('heading', { name: 'both' })

    // One tag keeps every series that carries it.
    await chooseTag(user, 'beta')
    await waitFor(() =>
      expect(selectedTagLabel()).toContain('beta')
    )
    expect(await screen.findByRole('heading', { name: 'both' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'alpha-only' })).toBeNull()

    await chooseTag(user, 'alpha')

    await waitFor(() => {
      expect(selectedTagLabel()).toContain('alpha')
      expect(selectedTagLabel()).toContain('beta')
    })
    // Intersection: the second tag narrows the result instead of broadening it.
    // `alpha-only` carries just one of the two selected tags, so it drops out
    // while `both` survives.
    expect(await screen.findByRole('heading', { name: 'both' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'alpha-only' })).toBeNull())
  })

  it('searches across pages and resets pagination for the matching result', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      return installedData(installedPage(25))
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'skill-00' })
    expect(screen.queryByRole('heading', { name: 'skill-24' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Power pages' })).toBeTruthy()
    const search = screen.getByRole('searchbox', { name: 'Search capabilities' })

    await user.type(search, 'skill-24')
    expect(await screen.findByRole('heading', { name: 'skill-24' })).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: 'Power pages' })).toBeNull()

    await user.clear(search)
    await screen.findByRole('heading', { name: 'skill-00' })
    expect(screen.getByRole('navigation', { name: 'Power pages' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'skill-20' })
    expect(pageNumber()).toBe('2')
    await user.type(search, 'skill-24')
    expect(await screen.findByRole('heading', { name: 'skill-24' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Power pages' })).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(1)
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

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await screen.findByRole('heading', { name: 'market-00' })

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(pageNumber()).toBe('1'))
    await screen.findByRole('heading', { name: 'market-00' })
  })

  it('does not restart an in-flight market load when the window regains focus', async () => {
    const user = userEvent.setup()
    let marketRequests = 0
    let release: (() => void) | undefined
    const { hostApi } = makeStoreHost(async (input) => {
      if (wireParamsOf(input).scope === 'market') {
        marketRequests += 1
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return await marketData()
      }
      return installedData(codeReviewList)
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await waitFor(() => expect(marketRequests).toBe(1))

    // Focusing the window while the market catalog is downloading must not abort
    // and re-issue the read; that abort used to surface as "request was cancelled".
    fireEvent.focus(window)
    fireEvent.focus(window)
    expect(marketRequests).toBe(1)

    release!()
    await screen.findByRole('heading', { name: 'market-translate' })
    expect(screen.queryByText('Power catalog request was cancelled.')).toBeNull()
  })

  it('refreshes the current catalog query from the header icon button', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost()
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    const refresh = screen.getByRole('button', { name: 'Refresh' })
    // Symbol copy, not a label: the visible content stays an icon.
    expect(refresh.textContent).toBe('↻')
    // Refresh sits to the left of the create entry, in the action row.
    const actionRow = document.querySelector('.agent-hub__actions') as HTMLElement
    expect(within(actionRow).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '↻',
      'Create',
    ])

    const listCalls = () => calls.filter((call) => call.operationId === 'powers.list.v1')
    expect(listCalls()).toHaveLength(1)

    await user.click(refresh)

    // The click re-reads the same query: same wire params, one extra request, and
    // the page neither jumps back to page 1 nor drops the selected filters.
    await waitFor(() => expect(listCalls()).toHaveLength(2))
    expect(wireParamsOf(listCalls()[1])).toEqual(wireParamsOf(listCalls()[0]))
    await screen.findByRole('heading', { name: 'code-review' })
    expect(screen.queryByRole('navigation', { name: 'Power pages' })).toBeNull()
  })

  it('hides the header refresh entry on the Settings tab', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) =>
      input.operationId === 'settings.get.v2' ? settingsData() : installedData(codeReviewList)
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByTestId('api-key-count')

    // The leaf panel renders no catalog, so it must not offer a button that would
    // re-read a list it does not show. Returning to a catalog tab brings it back.
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'My Capabilities' }))
    expect(await screen.findByRole('heading', { name: 'code-review' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })

  it('disables the header refresh entry while a catalog read is in flight', async () => {
    const user = userEvent.setup()
    let marketRequests = 0
    let release: (() => void) | undefined
    const { hostApi } = makeStoreHost(async (input) => {
      if (wireParamsOf(input).scope === 'market') {
        marketRequests += 1
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return await marketData()
      }
      return installedData(codeReviewList)
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await waitFor(() => expect(marketRequests).toBe(1))

    // Refreshing mid-read would abort and re-issue it, which is the spurious
    // cancellation the window-focus refresh already avoids by checking the status.
    const refresh = screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement
    expect(refresh.disabled).toBe(true)
    await user.click(refresh)
    expect(marketRequests).toBe(1)

    release!()
    await screen.findByRole('heading', { name: 'market-translate' })
    await waitFor(() => expect(refresh.disabled).toBe(false))
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
    // cancelled is retryable: it means "superseded or session torn down", not a
    // user action, so the page must offer a way out instead of dead-ending.
    ['cancelled', 'Power catalog request was cancelled.', true],
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
      installedData(wireParamsOf(input).scope === 'installed' ? installedPage(25) : '[]')
    )
    const view = renderLocalizedPage(hostApi, 'en')

    await screen.findByRole('heading', { name: 'skill-00' })
    expect(screen.queryByText('INTERNAL CATALOG')).toBeNull()
    expect(screen.getByRole('button', { name: 'My Capabilities' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Capability Market' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'Page number' })).toBeTruthy()
    expect(screen.getByText('of 2')).toBeTruthy()

    rerenderLocalizedPage(view, hostApi, 'zh-CN')

    expect(screen.getByRole('button', { name: '我的能力' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '能力市场' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: '页码' })).toBeTruthy()
    expect(screen.getByText('/ 2 页')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'My Capabilities' })).toBeNull()
  })

  it('renders the localized display name of an installed Power', async () => {
    const { hostApi } = makeStoreHost(() => installedData(localizedInstalledList))
    renderLocalizedPage(hostApi, 'zh-CN')

    expect(await screen.findByRole('heading', { name: '代码审查' })).toBeTruthy()
    expect(screen.getByText('代码审查工作流。')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'code-review' })).toBeNull()
  })

  it('renders the localized display name of a market Power', async () => {
    const user = userEvent.setup()
    const translatedCatalog = {
      scope: 'market',
      status: 'data',
      snapshot: await sha256(localizedCatalogJson),
      catalogJson: localizedCatalogJson,
    }
    const { hostApi, calls } = makeStoreHost((input) =>
      wireParamsOf(input).scope === 'market' ? translatedCatalog : installedData('[]')
    )
    renderLocalizedPage(hostApi, 'zh-CN')
    await screen.findByText('bibit 没有安装能力。')

    await user.click(screen.getByRole('button', { name: '能力市场' }))

    expect(await screen.findByRole('heading', { name: '翻译助手' })).toBeTruthy()
    expect(screen.getByText('翻译文本。')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'market-translate' })).toBeNull()
    expect(calls.some((call) => call.operationId === 'powers.list.v1')).toBe(true)
  })

  it('swaps display names with the language without re-reading the catalog', async () => {
    const listCalls = (calls: StoreRequest[]) =>
      calls.filter((call) => call.operationId === 'powers.list.v1').length
    const { hostApi, calls } = makeStoreHost(() => installedData(localizedInstalledList))
    const view = renderLocalizedPage(hostApi, 'en')

    await screen.findByRole('heading', { name: 'Code Review' })
    const before = listCalls(calls)

    rerenderLocalizedPage(view, hostApi, 'zh-CN')

    expect(await screen.findByRole('heading', { name: '代码审查' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Code Review' })).toBeNull()
    await waitFor(() => expect(listCalls(calls)).toBe(before))
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

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
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
    const installedResolvers: Array<(value: unknown) => void> = []
    const marketResolvers: Array<(value: unknown) => void> = []
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      if (wireParamsOf(input).scope === 'market') {
        return new Promise((resolve) => marketResolvers.push(resolve))
      }
      return new Promise((resolve) => installedResolvers.push(resolve))
    })
    renderPage(hostApi)

    await waitFor(() => expect(installedResolvers).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await waitFor(() => expect(marketResolvers).toHaveLength(1))

    marketResolvers[0](await marketData())
    await screen.findByRole('heading', { name: 'market-translate' })

    installedResolvers[0](installedData(codeReviewList))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'code-review' })).toBeNull())
    expect(screen.getByRole('heading', { name: 'market-translate' })).toBeTruthy()
    expect(calls.length).toBeGreaterThan(0)
  })

  it('renders the fixed Agent menu and loads Hermes when selected', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData()
      return installedData(
        wireParamsOf(input).agent === 'hermes-agent'
          ? JSON.stringify([{ ...codeReviewRecord, agent: 'hermes-agent' }])
          : '[]'
      )
    })
    renderPage(hostApi)
    await screen.findByText('No powers are installed for bibit.')

    await user.hover(screen.getByRole('button', { name: 'Agent: bibit' }))

    expect(screen.getByRole('menuitemradio', { name: 'bibit' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'codex' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'claude-code' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'hermes-agent' }))
    await screen.findByRole('heading', { name: 'code-review' })
    const listCalls = calls.filter((call) => call.operationId === 'powers.list.v1')
    expect(wireParamsOf(listCalls[listCalls.length - 1])).toEqual({
      scope: 'installed',
      agent: 'hermes-agent',
    })
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

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
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

    it('keeps the card on the newest version while the dialog picks one', async () => {
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
      await user.click(screen.getByRole('button', { name: 'Capability Market' }))
      await screen.findByRole('heading', { name: 'market-translate' })

      // The card uses the newest description; version selection stays in details.
      expect(screen.queryByTestId('power-card-version')).toBeNull()
      expect(screen.getByText('Translates v2.')).toBeTruthy()
      expect(screen.queryByLabelText('Version')).toBeNull()

      await user.click(screen.getByRole('heading', { name: 'market-translate' }))
      const dialog = within(document.querySelector('dialog') as HTMLElement)
      // Opening the dialog starts on the newest version too.
      expect((dialog.getByLabelText('Version') as HTMLSelectElement).value).toBe('v2.0.0')
      expect(dialog.getByText('Translates v2.')).toBeTruthy()

      await user.selectOptions(dialog.getByLabelText('Version'), 'v1.0.0')
      expect(dialog.getByText('Translates v1.')).toBeTruthy()

      await user.click(dialog.getByRole('button', { name: 'Close' }))

      // The card never followed the dialog's choice.
      await waitFor(() => expect(screen.getByText('Translates v2.')).toBeTruthy())
      expect(screen.queryByText('Translates v1.')).toBeNull()
    })

    it('marks a market card New when the chosen Agent is a version behind', async () => {
      const user = userEvent.setup()
      const behind = JSON.stringify([
        { ...codeReviewRecord, name: 'market-translate', version: 'v1.0.0' },
      ])
      const { hostApi } = makeStoreHost((input) => {
        if (input.operationId === 'powers.custom.list.v1') return customData()
        const params = wireParamsOf(input)
        return params.scope === 'market' ? twoVersionMarketData() : installedData(behind)
      })
      renderPage(hostApi)
      await screen.findByRole('heading', { name: 'market-translate' })

      await user.click(screen.getByRole('button', { name: 'Capability Market' }))
      await screen.findByRole('heading', { name: 'market-translate' })

      // Keep the update information and show installation at the start of the tag row.
      await waitFor(() => expect(screen.getByText('New')).toBeTruthy())
      expect(
        Array.from(document.querySelectorAll('.power-card__badge')).map((badge) => badge.textContent)
      ).toEqual(['New'])
      expect(document.querySelector('.power-card__tags')?.firstElementChild?.textContent).toBe('Installed')
      // The card version is omitted while the description still uses the newest entry.
      expect(screen.queryByTestId('power-card-version')).toBeNull()
    })

    it('shows no New badge once the newest version is the installed one', async () => {
      const user = userEvent.setup()
      const current = JSON.stringify([
        { ...codeReviewRecord, name: 'market-translate', version: 'v2.0.0' },
      ])
      const { hostApi } = makeStoreHost((input) => {
        if (input.operationId === 'powers.custom.list.v1') return customData()
        const params = wireParamsOf(input)
        return params.scope === 'market' ? twoVersionMarketData() : installedData(current)
      })
      renderPage(hostApi)
      await screen.findByRole('heading', { name: 'market-translate' })

      await user.click(screen.getByRole('button', { name: 'Capability Market' }))
      await screen.findByRole('heading', { name: 'market-translate' })

      await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
      expect(screen.queryByText('New')).toBeNull()
    })

    it('updates an installed Power to the chosen version after confirming', async () => {
      const user = userEvent.setup()
      let installCall: StoreRequest | undefined
      const { hostApi } = makeStoreHost((input) => {
        const params = wireParamsOf(input)
        if (input.operationId === 'powers.list.v1') {
          return params.scope === 'market' ? twoVersionMarketData() : installedData('[]')
        }
        if (input.operationId === 'powers.custom.list.v1') return customData()
        if (input.operationId === 'powers.inspect.v1') {
          return {
            listJson: JSON.stringify([
              { agent: 'bibit', type: 'skill', name: 'market-translate', version: 'v1.0.0', description: '', tags: [] },
            ]),
          }
        }
        if (input.operationId === 'powers.install.v1') {
          installCall = input
          return { status: 'exited', exitCode: 0 }
        }
        throw new Error('unexpected op ' + input.operationId)
      })
      renderPage(hostApi)
      await user.click(screen.getByRole('button', { name: 'Capability Market' }))
      await screen.findByRole('heading', { name: 'market-translate' })

      await user.click(screen.getByRole('heading', { name: 'market-translate' }))
      const dialog = within(document.querySelector('dialog') as HTMLElement)
      // The dialog opens on the newest, which for an installed v1 is an update.
      await dialog.findByText('Installed v1.0.0')
      expect(dialog.getByRole('button', { name: 'Update' })).toBeTruthy()

      await user.click(dialog.getByRole('button', { name: 'Update' }))
      // Replacing the installed version confirms first.
      expect(installCall).toBeUndefined()
      expect(dialog.getByText('Update this Power?')).toBeTruthy()

      await user.click(dialog.getByRole('button', { name: 'Confirm update' }))

      await waitFor(() => expect(installCall?.operationId).toBe('powers.install.v1'))
      expect(installCall?.params).toEqual({
        agent: 'bibit',
        type: 'skill',
        name: 'market-translate',
        version: 'v2.0.0',
      })
    })

    it('adds the newest market version directly and then shows its installed badge', async () => {
      const user = userEvent.setup()
      let installed: unknown[] = []
      const { hostApi, calls } = makeStoreHost((input) => {
        if (input.operationId === 'powers.custom.list.v1') return customData()
        if (input.operationId === 'powers.list.v1') {
          return wireParamsOf(input).scope === 'market'
            ? twoVersionMarketData()
            : installedData(JSON.stringify(installed))
        }
        if (input.operationId === 'powers.inspect.v1') return { listJson: JSON.stringify(installed) }
        if (input.operationId === 'powers.install.v1') {
          installed = [{ ...codeReviewRecord, name: 'market-translate', version: 'v2.0.0' }]
          return { status: 'exited', exitCode: 0 }
        }
        throw new Error('unexpected op ' + input.operationId)
      })
      renderPage(hostApi)
      await screen.findByText('No powers are installed for bibit.')
      await user.click(screen.getByRole('button', { name: 'Capability Market' }))
      const add = await screen.findByRole('button', { name: 'Add capability' })
      await user.click(add)

      await waitFor(() => expect(calls.filter(call => call.operationId === 'powers.install.v1')).toHaveLength(1))
      expect(calls.find(call => call.operationId === 'powers.install.v1')?.params).toEqual({
        agent: 'bibit', type: 'skill', name: 'market-translate', version: 'v2.0.0',
      })
      expect(document.querySelector('dialog[open]')).toBeNull()
      expect(await screen.findByText('Installed')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Add capability' })).toBeNull()
      expect(await screen.findByText('Installation complete.')).toBeTruthy()
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
      await user.click(screen.getByRole('button', { name: 'Capability Market' }))
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

    it('uninstalls after the in-dialog confirmation, then returns to the list', async () => {
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

      // The first click only arms the confirmation.
      await user.click(dialog.getByRole('button', { name: 'Uninstall' }))
      expect(uninstallCall).toBeUndefined()
      expect(dialog.getByText('Uninstall this Power?')).toBeTruthy()

      await user.click(dialog.getByRole('button', { name: 'Confirm uninstall' }))

      await waitFor(() => expect(uninstallCall?.operationId).toBe('powers.uninstall.v1'))
      expect(uninstallCall?.params).toEqual({ agent: 'bibit', type: 'skill', name: 'code-review' })
      // The Power is gone, so the dialog must not stay open on it: the page returns
      // to the refreshed list instead.
      await waitFor(() => expect(document.querySelector('dialog')).toBeNull())
      expect(await screen.findByText('No powers are installed for bibit.')).toBeTruthy()
    })

    it('keeps the dialog with its reason when an uninstall fails', async () => {
      const user = userEvent.setup()
      // The command fails and the reconcile still lists the Power: nothing was
      // removed, so the dialog has to stay and explain itself.
      const { hostApi } = makeStoreHost((input) => {
        if (input.operationId === 'powers.list.v1') return installedData(codeReviewList)
        if (input.operationId === 'powers.inspect.v1') return { listJson: codeReviewList }
        if (input.operationId === 'powers.uninstall.v1') return { status: 'exited', exitCode: 1 }
        throw new Error('unexpected op ' + input.operationId)
      })
      renderPage(hostApi)
      await screen.findByRole('heading', { name: 'code-review' })

      await user.click(screen.getByRole('heading', { name: 'code-review' }))
      const dialog = within(document.querySelector('dialog') as HTMLElement)
      await dialog.findByText('Installed v1.0.0')
      await user.click(dialog.getByRole('button', { name: 'Uninstall' }))
      await user.click(dialog.getByRole('button', { name: 'Confirm uninstall' }))

      expect(await dialog.findByText('The command failed; version v1.0.0 is still installed.')).toBeTruthy()
      expect(document.querySelector('dialog')).toBeTruthy()
      expect(screen.queryByText('No powers are installed for bibit.')).toBeNull()
    })

    it('does not uninstall when the confirmation is cancelled', async () => {
      const user = userEvent.setup()
      let uninstallCalls = 0
      const { hostApi } = makeStoreHost((input) => {
        if (input.operationId === 'powers.list.v1') return installedData(codeReviewList)
        if (input.operationId === 'powers.inspect.v1') return { listJson: codeReviewList }
        if (input.operationId === 'powers.uninstall.v1') {
          uninstallCalls += 1
          return { status: 'exited', exitCode: 0 }
        }
        throw new Error('unexpected op ' + input.operationId)
      })
      renderPage(hostApi)
      await screen.findByRole('heading', { name: 'code-review' })

      await user.click(screen.getByRole('heading', { name: 'code-review' }))
      const dialog = within(document.querySelector('dialog') as HTMLElement)
      await dialog.findByText('Installed v1.0.0')
      await user.click(dialog.getByRole('button', { name: 'Uninstall' }))
      await user.click(dialog.getByRole('button', { name: 'Cancel' }))

      expect(uninstallCalls).toBe(0)
      expect(document.querySelector('dialog')).toBeTruthy()
      expect(dialog.getByRole('button', { name: 'Uninstall' })).toBeTruthy()
    })

    it('keeps the dialog open after a successful install', async () => {
      const user = userEvent.setup()
      // The reconcile has to observe the new record, otherwise the notice is the
      // "state does not match" mismatch rather than a success.
      let installed: unknown[] = []
      const { hostApi } = makeStoreHost((input) => {
        const params = wireParamsOf(input)
        if (input.operationId === 'powers.list.v1') {
          return params.scope === 'market' ? marketData() : installedData(JSON.stringify(installed))
        }
        if (input.operationId === 'powers.inspect.v1') return { listJson: JSON.stringify(installed) }
        if (input.operationId === 'powers.install.v1') {
          installed = [{ ...codeReviewRecord, name: 'market-translate' }]
          return { status: 'exited', exitCode: 0 }
        }
        throw new Error('unexpected op ' + input.operationId)
      })
      renderPage(hostApi)
      await user.click(screen.getByRole('button', { name: 'Capability Market' }))
      await screen.findByRole('heading', { name: 'market-translate' })

      await user.click(screen.getByRole('heading', { name: 'market-translate' }))
      const dialog = within(document.querySelector('dialog') as HTMLElement)
      await dialog.findByRole('button', { name: 'Install' })
      await user.click(dialog.getByRole('button', { name: 'Install' }))

      // Installing leaves the Power on disk, so its dialog stays useful.
      expect(await dialog.findByText('Installation complete.')).toBeTruthy()
      expect(document.querySelector('dialog')).toBeTruthy()
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
      // The Agent is read-only in the dialog; the tab row owns that choice.
      expect(dialog.getByTestId('dialog-agent-static').textContent).toBe('bibit')
      expect(dialog.queryByLabelText('Agent')).toBeNull()
      await user.click(dialog.getByRole('button', { name: 'Close' }))

      await user.click(screen.getByRole('button', { name: 'Capability Market' }))
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

describe('AgentHubPage custom resources', () => {
  const customItem = {
    type: 'skill',
    name: 'hand-written',
    version: '',
    description: 'Hand made.',
    tags: [],
    source: 'custom',
  }
  const customDocument = JSON.stringify({ items: [customItem], skipped: [] })
  const skippedDocument = JSON.stringify({
    items: [],
    skipped: [{ type: 'skill', name: 'partial', expected: 'SKILL.md', reason: 'invalid-authority-file' }],
  })

  it('renders a hand-installed resource with a Custom badge and no version control', async () => {
    const { hostApi } = makeStoreHost((input) =>
      input.operationId === 'powers.custom.list.v1' ? customData(customDocument) : installedData(codeReviewList)
    )
    renderPage(hostApi)

    await screen.findByRole('heading', { name: 'hand-written' })
    expect(screen.getByText('Custom')).toBeTruthy()
    expect(document.querySelector('.power-card[data-source="custom"]')).toBeTruthy()
    // Version information belongs in details, including for hand-installed resources.
    expect(screen.queryByLabelText('Version')).toBeNull()
    expect(
      document.querySelector('.power-card[data-source="custom"] .power-card__version')
    ).toBeNull()
  })

  it('shows the declared name of a v1 resource instead of its directory name', async () => {
    // The scanner reports identity (directory) and the display fallback
    // separately, so the card must render the name its author declared.
    const item = { ...customItem, name: 'vi-coder', name_en: 'vibe-coder' }
    const { hostApi } = makeStoreHost((input) =>
      input.operationId === 'powers.custom.list.v1'
        ? customData(JSON.stringify({ items: [item], skipped: [] }))
        : installedData('[]')
    )
    const view = renderLocalizedPage(hostApi, 'en')

    expect(await screen.findByRole('heading', { name: 'vibe-coder' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'vi-coder' })).toBeNull()

    // Switching language must not resurrect the directory name.
    rerenderLocalizedPage(view, hostApi, 'zh-CN')

    expect(screen.getByRole('heading', { name: 'vibe-coder' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'vi-coder' })).toBeNull()
  })

  it('prefers name_zh over the declared name on a Chinese host', async () => {
    const item = { ...customItem, name: 'zh-dir', name_zh: '中文名', name_en: 'Declared Name' }
    const { hostApi } = makeStoreHost((input) =>
      input.operationId === 'powers.custom.list.v1'
        ? customData(JSON.stringify({ items: [item], skipped: [] }))
        : installedData('[]')
    )
    const view = renderLocalizedPage(hostApi, 'zh-CN')

    expect(await screen.findByRole('heading', { name: '中文名' })).toBeTruthy()
    // An English host never sees Chinese, and still gets the declared name.
    rerenderLocalizedPage(view, hostApi, 'en')

    expect(screen.getByRole('heading', { name: 'Declared Name' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '中文名' })).toBeNull()
  })

  it('renders the scan warnings as translated text', async () => {
    const { hostApi } = makeStoreHost((input) =>
      input.operationId === 'powers.custom.list.v1' ? customData(skippedDocument) : installedData(codeReviewList)
    )
    renderPage(hostApi)

    await screen.findByRole('heading', { name: 'code-review' })
    expect(
      await screen.findByText('Skipped skill "partial": its SKILL.md does not meet the minimum format.')
    ).toBeTruthy()
  })

  it('keeps the Hub list when the custom scan is unsupported by the provider', async () => {
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') {
        throw { version: 1, code: 'incompatible', message: 'unknown operation', retryable: false }
      }
      return installedData(codeReviewList)
    })
    renderPage(hostApi)

    await screen.findByRole('heading', { name: 'code-review' })
    expect(await screen.findByText('Custom resources could not be scanned for this Agent.')).toBeTruthy()
    expect(document.querySelector('.agent-hub__error')).toBeNull()
  })

  it('opens the custom dialog without asking apm to inspect the resource', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) =>
      input.operationId === 'powers.custom.list.v1' ? customData(customDocument) : installedData('[]')
    )
    renderPage(hostApi)

    await user.click(await screen.findByRole('heading', { name: 'hand-written' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    expect(dialog.getByText('Installed outside Agent Hub; not managed by APM.')).toBeTruthy()
    expect(calls.filter((call) => call.operationId === 'powers.inspect.v1')).toHaveLength(0)
  })

  it('uploads with the entered message and re-reads the installed view', async () => {
    const user = userEvent.setup()
    let uploadCall: StoreRequest | undefined
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') {
        return customData(uploadCall ? '{"items":[],"skipped":[]}' : customDocument)
      }
      if (input.operationId === 'powers.upload.v1') {
        uploadCall = input
        return { status: 'exited', exitCode: 0, stage: 'submit', stdout: 'submission_id: sub_42' }
      }
      return installedData('[]')
    })
    renderPage(hostApi)

    await user.click(await screen.findByRole('heading', { name: 'hand-written' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    await user.click(dialog.getByRole('button', { name: 'Upload' }))
    await user.type(dialog.getByLabelText('Publish message'), 'Publish the local demo skill')
    await user.click(dialog.getByRole('button', { name: 'Upload to APC' }))

    expect(await dialog.findByText('Upload complete: sub_42')).toBeTruthy()
    expect(uploadCall?.params).toEqual({
      agent: 'bibit',
      type: 'skill',
      name: 'hand-written',
      message: 'Publish the local demo skill',
    })
    // The write refreshes the list, so the uploaded resource disappears from the
    // scan and the page falls back to the empty copy.
    expect(await screen.findByText('No powers are installed for bibit.')).toBeTruthy()
  })

  it('surfaces a missing APC key as a settings hint instead of a raw provider error', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData(customDocument)
      if (input.operationId === 'powers.upload.v1') {
        throw { version: 1, code: 'unauthorized', message: 'no key', retryable: false }
      }
      return installedData('[]')
    })
    renderPage(hostApi)

    await user.click(await screen.findByRole('heading', { name: 'hand-written' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    await user.click(dialog.getByRole('button', { name: 'Upload' }))
    await user.type(dialog.getByLabelText('Publish message'), 'Publish')
    await user.click(dialog.getByRole('button', { name: 'Upload to APC' }))

    expect(
      await dialog.findByText('APC API Key is not configured; set it in the Settings tab.')
    ).toBeTruthy()
  })

  it('reports the validate failure reason from a rejected upload', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData(customDocument)
      if (input.operationId === 'powers.upload.v1') {
        return { status: 'exited', exitCode: 1, stage: 'validate', reason: 'schema_version 1 is not accepted' }
      }
      return installedData('[]')
    })
    renderPage(hostApi)

    await user.click(await screen.findByRole('heading', { name: 'hand-written' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    await user.click(dialog.getByRole('button', { name: 'Upload' }))
    await user.type(dialog.getByLabelText('Publish message'), 'Publish')
    await user.click(dialog.getByRole('button', { name: 'Upload to APC' }))

    // apm's own sentence is the actionable text, so it is shown verbatim.
    expect(await dialog.findByText('Upload failed: schema_version 1 is not accepted')).toBeTruthy()
  })

  it('falls back to the stage copy when apm reported no reason', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData(customDocument)
      if (input.operationId === 'powers.upload.v1') {
        return { status: 'exited', exitCode: 1, stage: 'validate' }
      }
      return installedData('[]')
    })
    renderPage(hostApi)

    await user.click(await screen.findByRole('heading', { name: 'hand-written' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    await user.click(dialog.getByRole('button', { name: 'Upload' }))
    await user.type(dialog.getByLabelText('Publish message'), 'Publish')
    await user.click(dialog.getByRole('button', { name: 'Upload to APC' }))

    expect(
      await dialog.findByText('This resource does not meet the Power format required for upload; fix it and retry.')
    ).toBeTruthy()
  })

  it('deletes only after the footer confirmation, then returns to the Hub list', async () => {
    const user = userEvent.setup()
    let deleteCall: StoreRequest | undefined
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') {
        return customData(deleteCall ? '{"items":[],"skipped":[]}' : customDocument)
      }
      if (input.operationId === 'powers.delete.v1') {
        deleteCall = input
        return { status: 'deleted' }
      }
      return installedData('[]')
    })
    renderPage(hostApi)

    await user.click(await screen.findByRole('heading', { name: 'hand-written' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    await user.click(dialog.getByRole('button', { name: 'Delete' }))

    // Nothing happens until the confirmation inside the dialog is clicked.
    expect(deleteCall).toBeUndefined()
    await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

    expect(deleteCall?.params).toEqual({ agent: 'bibit', type: 'skill', name: 'hand-written' })
    // The resource is gone, so its dialog must not stay open on a Power that no
    // longer exists: the page returns to the list, which has already refreshed.
    expect(await screen.findByText('No powers are installed for bibit.')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('dialog')).toBeNull())
    expect(screen.queryByText('Deleted skill "hand-written".')).toBeNull()
  })

  it('keeps the dialog open and reports the reason when a delete fails', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'powers.custom.list.v1') return customData(customDocument)
      if (input.operationId === 'powers.delete.v1') {
        throw { version: 1, code: 'unavailable', message: 'provider down', retryable: true }
      }
      return installedData('[]')
    })
    renderPage(hostApi)

    await user.click(await screen.findByRole('heading', { name: 'hand-written' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    await user.click(dialog.getByRole('button', { name: 'Delete' }))
    await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

    expect(await dialog.findByText('The custom resource service is unavailable.')).toBeTruthy()
    // A failed delete leaves the resource in place, so the dialog stays readable.
    expect(document.querySelector('dialog')).toBeTruthy()
  })

  it('does not offer install or uninstall for a hand-installed resource', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) =>
      input.operationId === 'powers.custom.list.v1' ? customData(customDocument) : installedData(codeReviewList)
    )
    renderPage(hostApi)

    await user.click(await screen.findByRole('heading', { name: 'hand-written' }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    expect(dialog.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(dialog.queryByRole('button', { name: 'Uninstall' })).toBeNull()
    expect(dialog.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })
})

describe('AgentHubPage settings tab', () => {
  it('opens the credential panel without spending a catalog request', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) =>
      input.operationId === 'settings.get.v2' ? settingsData() : installedData(codeReviewList)
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })
    const listCallsBefore = calls.filter((call) => call.operationId === 'powers.list.v1').length

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(await screen.findByTestId('api-key-count')).toBeTruthy()
    expect((await screen.findByTestId('api-key-count')).textContent).toBe('No key saved')
    expect(calls.some((call) => call.operationId === 'settings.get.v2')).toBe(true)
    // The tab renders no catalog, so it must not issue a list request or keep a
    // row of Type/Tag filters that filter nothing.
    expect(calls.filter((call) => call.operationId === 'powers.list.v1')).toHaveLength(listCallsBefore)
    expect(screen.queryByRole('group', { name: 'Type' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('saves and lists the APC key and reloads the catalog when the user goes back', async () => {
    const user = userEvent.setup()
    let addCall: StoreRequest | undefined
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'settings.get.v2') return settingsData()
      if (input.operationId === 'settings.keys.add.v1') {
        addCall = input
        return settingsData([{ id: '0123456789abcdef0123456789abcdef', preview: 'apc-****cret', enabled: true }])
      }
      return installedData(codeReviewList)
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByTestId('api-key-count')
    await user.type(screen.getByLabelText('APC API Key'), 'apc-secret')
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    expect(await screen.findByText('Key saved.')).toBeTruthy()
    expect(addCall?.params).toEqual({ apiKey: 'apc-secret' })
    // The key is never echoed back, only its masked preview and enabled state.
    expect(screen.getByText('apc-****cret')).toBeTruthy()
    expect(screen.queryByText('apc-secret')).toBeNull()
    expect(screen.getByTestId('api-key-count').textContent).toBe('1 saved')
    expect((screen.getByLabelText('APC API Key') as HTMLInputElement).value).toBe('')

    const listCallsBefore = calls.filter((call) => call.operationId === 'powers.list.v1').length
    await user.click(screen.getByRole('button', { name: 'My Capabilities' }))

    expect(await screen.findByRole('heading', { name: 'code-review' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeTruthy()
    await waitFor(() =>
      expect(calls.filter((call) => call.operationId === 'powers.list.v1').length).toBeGreaterThan(
        listCallsBefore
      )
    )
  })
})

describe('create-resource entry (host:actions)', () => {
  const draft = CREATE_RESOURCE_PROMPT_LINES.join('\n')
  const createButton = () => screen.getByRole('button', { name: 'Create' })

  it('stages the Chinese draft the create entry asks for', async () => {
    // The entry exists to pre-fill this text, so the localized copy is asserted
    // end to end -- page -> composePrompt -> the host action's payload -- rather
    // than only in the translator's own unit test.
    const user = userEvent.setup()
    const { actions, calls } = makeComposeActions()
    const { hostApi } = makeStoreHost(undefined, actions)
    renderLocalizedPage(hostApi, 'zh-CN')
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].input).toEqual({
      prompt: [
        '请使用using-apm技能帮我新建一个能力资源。',
        '资源类型（Skill/Plugin/MCP/Expert）：',
        '资源的要求：',
      ].join('\n'),
    })
  })

  it('asks the host to compose a new conversation with the preset draft', async () => {
    const user = userEvent.setup()
    const { actions, calls } = makeComposeActions()
    const { hostApi } = makeStoreHost(undefined, actions)
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(createButton())

    // Exactly one call: the action only stages a draft, so the entry neither
    // sends a message nor retries anything by itself.
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].action).toBe(CREATE_RESOURCE_ACTION)
    expect(calls[0].input).toEqual({ prompt: draft })
    // The draft is what makes the built-in using-apm skill take over the task.
    expect((calls[0].input as { prompt: string }).prompt).toContain('using-apm')
  })

  it('keeps the entry disabled and explains why on hover or focus without the capability', async () => {
    const user = userEvent.setup()
    // The host reports no `host:actions` at all: missing grant, older host, or a
    // build without the action registry. That is a supported state, not a bug.
    const { hostApi } = makeStoreHost()
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    expect((createButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(ACTIONS_UNAVAILABLE_TEXT)).toBeNull()
    const trigger = createButton().parentElement!
    await user.hover(trigger)
    expect(screen.getByRole('tooltip').textContent).toBe(ACTIONS_UNAVAILABLE_TEXT)
    await user.unhover(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => trigger.focus())
    expect(screen.getByRole('tooltip').textContent).toBe(ACTIONS_UNAVAILABLE_TEXT)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => trigger.blur())

    await user.click(createButton())
    await user.click(createButton())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports an unsupported action with plugin copy, not the host debug string', async () => {
    const user = userEvent.setup()
    const { actions, calls } = makeComposeActions(() => ({
      status: 'rejected',
      error: { code: 'UNSUPPORTED', message: 'Unknown host action: conversation.compose' },
    }))
    const { hostApi } = makeStoreHost(undefined, actions)
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(createButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(COMPOSE_UNSUPPORTED_TEXT)
    expect(alert.textContent).not.toContain('Unknown host action')
    expect(calls).toHaveLength(1)
  })

  it('shows a retryable host failure and leaves retrying to the user', async () => {
    const user = userEvent.setup()
    const { actions, calls } = makeComposeActions(() => ({
      status: 'rejected',
      error: { code: 'FAILED', message: '输入框仍有未发送内容', retryable: true },
    }))
    const { hostApi } = makeStoreHost(undefined, actions)
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(createButton())

    const alert = await screen.findByRole('alert')
    // The host already localized its own message, so it is rendered as-is.
    expect(alert.textContent).toContain('输入框仍有未发送内容')
    expect(alert.textContent).toContain(COMPOSE_RETRY_HINT)
    // No automatic retry loop: still the single user-initiated call.
    await waitFor(() => expect(calls).toHaveLength(1))
    expect((createButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('treats a cancelled compose as the user backing out, not an error', async () => {
    const user = userEvent.setup()
    const { actions, calls } = makeComposeActions(() => ({ status: 'cancelled' }))
    const { hostApi } = makeStoreHost(undefined, actions)
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(createButton())

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not start a second compose while the first one is in flight', async () => {
    const user = userEvent.setup()
    let resolveCompose!: (result: FeatureHostActionResultV1) => void
    const { actions, calls } = makeComposeActions(
      () => new Promise<FeatureHostActionResultV1>((resolve) => (resolveCompose = resolve))
    )
    const { hostApi } = makeStoreHost(undefined, actions)
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(createButton())
    await waitFor(() => expect(calls).toHaveLength(1))
    expect((createButton() as HTMLButtonElement).disabled).toBe(true)

    await user.click(createButton())
    expect(calls).toHaveLength(1)

    resolveCompose({ status: 'completed' })
    await waitFor(() => expect((createButton() as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('bulk upgrade (Update all)', () => {
  const upgradeResponse = (items: unknown[] = [], exitCode = 0) => ({
    status: 'exited',
    exitCode,
    items,
    reason: '',
  })
  const upgraded = (name: string, outcome = 'upgraded') => ({
    agent: 'bibit',
    type: 'skill',
    name,
    currentVersion: 'v1.0.0',
    targetVersion: 'v2.0.0',
    outcome,
    skip: '',
  })

  const upgradeButton = () => screen.getByRole('button', { name: 'Update all' })

  it('offers the upgrade entry on the installed list beside the Agent control', async () => {
    const { hostApi } = makeStoreHost()
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    const actions = document.querySelector('.power-filters__actions')
    const button = upgradeButton()
    const switcher = screen.getByRole('button', { name: 'Agent: bibit' })
    expect(actions?.contains(button)).toBe(true)
    expect(actions?.contains(switcher)).toBe(true)
  })

  it('keeps the entry off the market and settings tabs', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) =>
      wireParamsOf(input).scope === 'market' ? marketData() : installedData(codeReviewList)
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    await screen.findByRole('heading', { name: 'market-translate' })
    expect(screen.queryByRole('button', { name: 'Update all' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.queryByRole('button', { name: 'Update all' })).toBeNull()
  })

  it('opens a dialog and sends nothing until it is confirmed', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) =>
      input.operationId === 'powers.upgrade.v1' ? upgradeResponse() : installedData(codeReviewList)
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(upgradeButton())

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
    // Opening the confirmation is not consent: no upgrade may have been sent.
    expect(calls.some((call) => call.operationId === 'powers.upgrade.v1')).toBe(false)
  })

  it('sends exactly one upgrade for the chosen scope', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) =>
      input.operationId === 'powers.upgrade.v1' ? upgradeResponse([upgraded('code-review')]) : installedData(codeReviewList)
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(upgradeButton())
    await user.selectOptions(screen.getByLabelText('Choose which Agents to update'), 'codex')
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() =>
      expect(calls.filter((call) => call.operationId === 'powers.upgrade.v1')).toHaveLength(1)
    )
    const upgrade = calls.find((call) => call.operationId === 'powers.upgrade.v1')
    expect(upgrade?.params).toEqual({ agent: 'codex' })
    expect(upgrade?.timeoutMs).toBe(300_000)
  })

  it('offers the whole machine as a scope, with all available', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost()
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(upgradeButton())

    const select = screen.getByLabelText('Choose which Agents to update') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual([
      'all',
      'bibit',
      'codex',
      'claude-code',
      'hermes-agent',
    ])
    expect(screen.getByRole('option', { name: 'All Agents' })).toBeTruthy()
  })

  it('freezes the tabs, the cards and the list while the upgrade runs', async () => {
    const user = userEvent.setup()
    let resolveUpgrade: ((value: unknown) => void) | undefined
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.upgrade.v1') {
        return new Promise((resolve) => {
          resolveUpgrade = resolve
        })
      }
      return installedData(codeReviewList)
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })
    const listCallsBefore = calls.filter((call) => call.operationId === 'powers.list.v1').length

    await user.click(upgradeButton())
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(resolveUpgrade).toBeDefined())

    // The provider is one serial process, so a list request issued now would queue
    // behind the upgrade and then trip its own read timeout: none may be sent.
    expect((screen.getByRole('button', { name: 'Capability Market' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(true)

    // Clicking a frozen tab must not switch (the disabled attribute plus the guard).
    await user.click(screen.getByRole('button', { name: 'Capability Market' }))
    expect(screen.getByRole('heading', { name: 'code-review' })).toBeTruthy()

    // The card's detail entry is busy too, so nothing can start a second write.
    expect((screen.getByRole('button', { name: 'code-review' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls.filter((call) => call.operationId === 'powers.list.v1').length).toBe(listCallsBefore)

    // The dialog cannot be dismissed while the run is in flight. Scoped to the
    // upgrade dialog: the details dialog has a control with the same name.
    const upgradeDialog = screen.getByRole('dialog', { name: 'Update all' })
    expect((within(upgradeDialog).getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true)

    resolveUpgrade?.(upgradeResponse([upgraded('code-review')]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeTruthy())
    await waitFor(() =>
      expect(screen.getByText('Updated 1 Power(s).')).toBeTruthy()
    )
  })

  it('refreshes the list once the upgrade finishes', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) =>
      input.operationId === 'powers.upgrade.v1'
        ? upgradeResponse([upgraded('code-review')])
        : installedData(codeReviewList)
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })
    const before = calls.filter((call) => call.operationId === 'powers.list.v1').length

    await user.click(upgradeButton())
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await screen.findByText('Updated 1 Power(s).')

    await waitFor(() =>
      expect(calls.filter((call) => call.operationId === 'powers.list.v1').length).toBeGreaterThan(
        before
      )
    )
    // The tabs come back once the lock is released.
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Capability Market' }) as HTMLButtonElement).disabled).toBe(false)
    )
  })

  it('reports a run where nothing needed updating', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) =>
      input.operationId === 'powers.upgrade.v1'
        ? upgradeResponse([upgraded('code-review', 'up-to-date')])
        : installedData(codeReviewList)
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(upgradeButton())
    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(await screen.findByText('Nothing needed updating.')).toBeTruthy()
  })

  it('reports failed entries by count', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) =>
      input.operationId === 'powers.upgrade.v1'
        ? upgradeResponse([upgraded('a', 'failed'), upgraded('b', 'failed')], 1)
        : installedData(codeReviewList)
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(upgradeButton())
    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(await screen.findByText('2 Power(s) could not be updated.')).toBeTruthy()
  })

  it('asks the user to refresh when the run times out', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.upgrade.v1') {
        throw Object.assign(new Error('timed out'), { version: 1, code: 'timeout', retryable: true })
      }
      return installedData(codeReviewList)
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })
    const before = calls.filter((call) => call.operationId === 'powers.list.v1').length

    await user.click(upgradeButton())
    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(
      await screen.findByText('The result needs confirmation; refresh to read the actual state.')
    ).toBeTruthy()
    // A timeout does not mean nothing changed, so the list is re-read anyway.
    await waitFor(() =>
      expect(calls.filter((call) => call.operationId === 'powers.list.v1').length).toBeGreaterThan(
        before
      )
    )
  })

  it('does not start a second upgrade while one is running', async () => {
    const user = userEvent.setup()
    let resolveUpgrade: ((value: unknown) => void) | undefined
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'powers.upgrade.v1') {
        return new Promise((resolve) => {
          resolveUpgrade = resolve
        })
      }
      return installedData(codeReviewList)
    })
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(upgradeButton())
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(resolveUpgrade).toBeDefined())

    // The entry is disabled, so a second attempt sends nothing.
    expect((upgradeButton() as HTMLButtonElement).disabled).toBe(true)
    expect(calls.filter((call) => call.operationId === 'powers.upgrade.v1')).toHaveLength(1)

    resolveUpgrade?.(upgradeResponse([upgraded('code-review')]))
    await screen.findByText('Updated 1 Power(s).')
  })

  it('surfaces the provider reason when apm produced no result', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) =>
      input.operationId === 'powers.upgrade.v1'
        ? { status: 'exited', exitCode: 1, items: [], reason: 'APM lock is already held' }
        : installedData(codeReviewList)
    )
    renderPage(hostApi)
    await screen.findByRole('heading', { name: 'code-review' })

    await user.click(upgradeButton())
    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(await screen.findByText('APM lock is already held')).toBeTruthy()
  })
})
