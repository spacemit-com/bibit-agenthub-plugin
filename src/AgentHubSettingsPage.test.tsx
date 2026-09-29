import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  FeatureHostApiProvider,
  type FeatureHostApiV1,
  type FeatureHostCapabilityApiV1,
  type FeatureServiceApiV1,
  type FeatureServiceRequestV1,
  type FeatureSettingsProps,
} from '@bibit/feature-sdk'
import type { FeatureHostCapability } from '@bibit/feature-contracts'
import { AgentHubSettingsPage } from './AgentHubSettingsPage'
import { withAgentHubI18n } from './agentHubI18n'

afterEach(cleanup)

type StoreRequest = FeatureServiceRequestV1<'store'>

const settingsProps: FeatureSettingsProps = {
  featureId: 'agent-hub',
  contributionId: 'settings',
  subpath: '',
  search: {},
  navigation: { push: () => {}, replace: () => {}, back: () => {} },
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
      return { showExperimental: false, refreshMinutes: 15, hasApiKey: false } as TResult
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
  return {
    hostApi: {
      sdkApiVersion: 1,
      featureId: 'agent-hub',
      grantedCapabilities: ['service:store'],
      getCapability,
    },
    calls,
  }
}

// Same wrapping the production module applies to the settings contribution.
const LocalizedSettingsPage = withAgentHubI18n(AgentHubSettingsPage)

function renderSettings(hostApi: FeatureHostApiV1, language?: string) {
  return render(
    <FeatureHostApiProvider value={hostApi}>
      <LocalizedSettingsPage {...settingsProps} language={language} />
    </FeatureHostApiProvider>
  )
}

function rerenderSettings(
  view: ReturnType<typeof render>,
  hostApi: FeatureHostApiV1,
  language: string
) {
  view.rerender(
    <FeatureHostApiProvider value={hostApi}>
      <LocalizedSettingsPage {...settingsProps} language={language} />
    </FeatureHostApiProvider>
  )
}

describe('AgentHubSettingsPage', () => {
  it('renders the settings fields and the synchronized status in English', async () => {
    const { hostApi, calls } = makeStoreHost()
    renderSettings(hostApi, 'en')

    expect(screen.getByRole('heading', { name: 'Agent Hub settings' })).toBeTruthy()
    expect(screen.getByText('Experimental Agents')).toBeTruthy()
    expect(screen.getByText('Catalog refresh')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeTruthy()
    expect(await screen.findByText('Settings synchronized.')).toBeTruthy()
    expect(calls[0].operationId).toBe('settings.get.v1')
  })

  it('switches every settings label and status with the host language prop', async () => {
    const { hostApi } = makeStoreHost()
    const view = renderSettings(hostApi, 'en')
    await screen.findByText('Settings synchronized.')

    rerenderSettings(view, hostApi, 'zh-CN')

    expect(screen.getByRole('heading', { name: 'Agent Hub 设置' })).toBeTruthy()
    expect(screen.getByText('实验性 Agent')).toBeTruthy()
    expect(screen.getByText('目录刷新')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存设置' })).toBeTruthy()
    expect(screen.getByText('设置已同步。')).toBeTruthy()
    expect(screen.queryByText('Settings synchronized.')).toBeNull()
  })

  it('translates the save status without resubmitting when the language changes', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost()
    const view = renderSettings(hostApi, 'en')
    await screen.findByText('Settings synchronized.')

    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Settings saved.')).toBeTruthy()

    rerenderSettings(view, hostApi, 'zh-CN')

    expect(screen.getByText('设置已保存。')).toBeTruthy()
    expect(calls.filter((call) => call.operationId === 'settings.update.v1')).toHaveLength(1)
  })

  it('reports a localized save failure', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost((input) => {
      if (input.operationId === 'settings.update.v1') throw new Error('write rejected')
      return { showExperimental: true, refreshMinutes: 30, hasApiKey: false }
    })
    renderSettings(hostApi, 'zh-CN')

    await screen.findByText('设置已同步。')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(await screen.findByText('无法保存 Agent Hub 设置。')).toBeTruthy()
  })

  it('reports whether an APC API key is configured without ever showing it', async () => {
    const { hostApi } = makeStoreHost(() => ({
      showExperimental: false,
      refreshMinutes: 15,
      hasApiKey: true,
    }))
    renderSettings(hostApi, 'en')

    expect((await screen.findByTestId('api-key-state')).textContent).toBe('Configured')
    const field = screen.getByLabelText('APC API Key') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(field.value).toBe('')
  })

  it('sends apiKey only after a user edit, and clears it through the save', async () => {
    const user = userEvent.setup()
    const { hostApi, calls } = makeStoreHost((input) =>
      input.operationId === 'settings.update.v1'
        ? { showExperimental: false, refreshMinutes: 15, hasApiKey: true }
        : { showExperimental: false, refreshMinutes: 15, hasApiKey: false }
    )
    renderSettings(hostApi, 'en')
    await screen.findByText('Settings synchronized.')

    // An untouched field must not appear in the update at all.
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await screen.findByText('Settings saved.')
    const firstUpdate = calls.find((call) => call.operationId === 'settings.update.v1')
    expect(firstUpdate?.params).toEqual({ showExperimental: false, refreshMinutes: 15 })
    expect('apiKey' in (firstUpdate?.params as Record<string, unknown>)).toBe(false)

    await user.type(screen.getByLabelText('APC API Key'), 'apc-secret')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await screen.findByText('Settings saved.')
    const updates = calls.filter((call) => call.operationId === 'settings.update.v1')
    expect(updates[updates.length - 1].params).toMatchObject({ apiKey: 'apc-secret' })

    // Clearing sends the empty string, which the provider treats as "remove".
    await user.click(screen.getByRole('button', { name: 'Clear saved key' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await screen.findByText('Settings saved.')
    const afterClear = calls.filter((call) => call.operationId === 'settings.update.v1')
    expect(afterClear[afterClear.length - 1].params).toMatchObject({ apiKey: '' })
  })

  it('keeps the typed key out of the rendered document', async () => {
    const user = userEvent.setup()
    const { hostApi } = makeStoreHost()
    renderSettings(hostApi, 'en')
    await screen.findByText('Settings synchronized.')

    const field = screen.getByLabelText('APC API Key') as HTMLInputElement
    await user.type(field, 'apc-secret')
    expect(field.value).toBe('apc-secret')
    // The value lives only in the password field; nothing else renders it.
    expect(screen.queryByText('apc-secret')).toBeNull()
    const textOutsideTheField = Array.from(document.querySelectorAll('p, span, small, strong'))
      .map((node) => node.textContent ?? '')
      .join(' ')
    expect(textOutsideTheField).not.toContain('apc-secret')
  })

  it('prevents a double submit while a save is in flight', async () => {
    const user = userEvent.setup()
    let resolveSave!: (value: unknown) => void
    const { hostApi, calls } = makeStoreHost((input) => {
      if (input.operationId === 'settings.update.v1') {
        return new Promise((resolve) => (resolveSave = resolve))
      }
      return { showExperimental: false, refreshMinutes: 15, hasApiKey: false }
    })
    renderSettings(hostApi, 'en')
    await screen.findByText('Settings synchronized.')

    const saveButton = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement
    await user.click(saveButton)
    await waitFor(() => expect(saveButton.disabled).toBe(true))
    await user.click(saveButton)

    expect(calls.filter((call) => call.operationId === 'settings.update.v1')).toHaveLength(1)
    resolveSave({ showExperimental: false, refreshMinutes: 15, hasApiKey: false })
    await screen.findByText('Settings saved.')
  })

  it('reports a localized read failure', async () => {
    const { hostApi } = makeStoreHost(() => {
      throw new Error('read rejected')
    })
    renderSettings(hostApi, 'zh-CN')

    expect(await screen.findByText('无法加载 Agent Hub 设置。')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('设置已同步。')).toBeNull())
  })
})
