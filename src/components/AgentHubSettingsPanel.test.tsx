import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FeatureServiceApiV1, FeatureServiceRequestV1 } from '@bibit/feature-sdk'
import { AgentHubSettingsPanel } from './AgentHubSettingsPanel'
import { AgentHubI18nProvider } from '../agentHubI18n'

afterEach(cleanup)

type StoreRequest = FeatureServiceRequestV1<'store'>

function makeService(respond?: (input: StoreRequest) => unknown): {
  service: FeatureServiceApiV1<'store'>
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
  return { service, calls }
}

function renderPanel(service: FeatureServiceApiV1<'store'> | undefined, language?: string) {
  return render(
    <AgentHubI18nProvider language={language}>
      <AgentHubSettingsPanel service={service} />
    </AgentHubI18nProvider>
  )
}

function rerenderPanel(
  view: ReturnType<typeof render>,
  service: FeatureServiceApiV1<'store'> | undefined,
  language: string
) {
  view.rerender(
    <AgentHubI18nProvider language={language}>
      <AgentHubSettingsPanel service={service} />
    </AgentHubI18nProvider>
  )
}

describe('AgentHubSettingsPanel', () => {
  it('renders the credential field and the synchronized status in English', async () => {
    const { service, calls } = makeService()
    renderPanel(service, 'en')

    expect(screen.getByText('APC API Key')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeTruthy()
    expect(await screen.findByText('Settings synchronized.')).toBeTruthy()
    expect(calls[0].operationId).toBe('settings.get.v1')
  })

  it('carries no controls for the settings the page no longer exposes', async () => {
    // `showExperimental` and `refreshMinutes` are still part of the closed
    // settings.update.v1 DTO but nothing consumes them, so the panel must not
    // grow controls that would quietly do nothing.
    const { service } = makeService()
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    expect(screen.queryByText('Experimental Agents')).toBeNull()
    expect(screen.queryByText('Catalog refresh')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('switches every label and status with the host language prop', async () => {
    const { service } = makeService()
    const view = renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    rerenderPanel(view, service, 'zh-CN')

    expect(screen.getByText('APC API Key')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存设置' })).toBeTruthy()
    expect(screen.getByText('设置已同步。')).toBeTruthy()
    expect(screen.queryByText('Settings synchronized.')).toBeNull()
  })

  it('translates the save status without resubmitting when the language changes', async () => {
    const user = userEvent.setup()
    const { service, calls } = makeService()
    const view = renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Settings saved.')).toBeTruthy()

    rerenderPanel(view, service, 'zh-CN')

    expect(screen.getByText('设置已保存。')).toBeTruthy()
    expect(calls.filter((call) => call.operationId === 'settings.update.v1')).toHaveLength(1)
  })

  it('reports a localized save failure', async () => {
    const user = userEvent.setup()
    const { service } = makeService((input) => {
      if (input.operationId === 'settings.update.v1') throw new Error('write rejected')
      return { showExperimental: false, refreshMinutes: 15, hasApiKey: false }
    })
    renderPanel(service, 'zh-CN')

    await screen.findByText('设置已同步。')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(await screen.findByText('无法保存 Agent Hub 设置。')).toBeTruthy()
  })

  it('reports whether an APC API key is configured without ever showing it', async () => {
    const { service } = makeService(() => ({
      showExperimental: false,
      refreshMinutes: 15,
      hasApiKey: true,
    }))
    renderPanel(service, 'en')

    expect((await screen.findByTestId('api-key-state')).textContent).toBe('Configured')
    const field = screen.getByLabelText('APC API Key') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(field.value).toBe('')
  })

  it('sends apiKey only after a user edit, and clears it through the save', async () => {
    const user = userEvent.setup()
    const { service, calls } = makeService((input) =>
      input.operationId === 'settings.update.v1'
        ? { showExperimental: false, refreshMinutes: 15, hasApiKey: true }
        : { showExperimental: false, refreshMinutes: 15, hasApiKey: false }
    )
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    // An untouched field must not appear in the update at all, and the two
    // unconsumed settings still round-trip so the closed DTO stays satisfied.
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
    const { service } = makeService()
    renderPanel(service, 'en')
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
    const { service, calls } = makeService((input) => {
      if (input.operationId === 'settings.update.v1') {
        return new Promise((resolve) => (resolveSave = resolve))
      }
      return { showExperimental: false, refreshMinutes: 15, hasApiKey: false }
    })
    renderPanel(service, 'en')
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
    const { service } = makeService(() => {
      throw new Error('read rejected')
    })
    renderPanel(service, 'zh-CN')

    expect(await screen.findByText('无法加载 Agent Hub 设置。')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('设置已同步。')).toBeNull())
  })

  it('reports a missing Store capability instead of an empty form', () => {
    renderPanel(undefined, 'en')

    expect(screen.getByText('Store capability is unavailable.')).toBeTruthy()
    expect((screen.getByLabelText('APC API Key') as HTMLInputElement).disabled).toBe(true)
  })

  it('aborts the in-flight settings read when the tab is left', async () => {
    let captured: StoreRequest | undefined
    const { service } = makeService((input) => {
      captured = input
      return new Promise(() => {})
    })
    const view = renderPanel(service, 'en')

    await waitFor(() => expect(captured?.operationId).toBe('settings.get.v1'))
    expect(captured?.signal?.aborted).toBe(false)

    // Leaving the tab unmounts the panel; the request must not outlive it.
    view.unmount()

    expect(captured?.signal?.aborted).toBe(true)
  })
})
