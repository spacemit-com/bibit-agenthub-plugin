import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FeatureServiceApiV1, FeatureServiceRequestV1 } from '@bibit/feature-sdk'
import { AgentHubSettingsPanel } from './AgentHubSettingsPanel'
import { AgentHubI18nProvider } from '../agentHubI18n'

afterEach(cleanup)

type StoreRequest = FeatureServiceRequestV1<'store'>

const ID_ONE = '0123456789abcdef0123456789abcdef'
const ID_TWO = 'fedcba9876543210fedcba9876543210'

type KeyRow = { id: string; preview: string; enabled: boolean }

function view(keys: KeyRow[]) {
  return { showExperimental: false, refreshMinutes: 15, keys }
}

const empty = view([])

function makeService(respond?: (input: StoreRequest) => unknown): {
  service: FeatureServiceApiV1<'store'>
  calls: StoreRequest[]
} {
  const calls: StoreRequest[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: StoreRequest): Promise<TResult> {
      calls.push(input)
      if (respond) return (await respond(input)) as TResult
      return empty as TResult
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

const keyRows = () => within(screen.getByRole('list', { name: 'Saved API Keys' })).getAllByRole('listitem')

describe('AgentHubSettingsPanel', () => {
  it('renders the credential field, a Save key action and the synchronized status', async () => {
    const { service, calls } = makeService()
    renderPanel(service, 'en')

    expect(screen.getByText('APC API Key')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save key' })).toBeTruthy()
    expect(await screen.findByText('Settings synchronized.')).toBeTruthy()
    expect(calls[0].operationId).toBe('settings.get.v2')
    expect(calls[0].params).toEqual({})
  })

  it('has no Clear saved key control and no form-wide save', async () => {
    const { service } = makeService(() => view([{ id: ID_ONE, preview: 'apc-****-one', enabled: true }]))
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    expect(screen.queryByRole('button', { name: 'Clear saved key' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    // Only the per-row actions and the single add action exist.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Save key',
      'Enable',
      'Delete',
    ])
  })

  it('carries no controls for the settings the page no longer exposes', async () => {
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
    const panel = renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    rerenderPanel(panel, service, 'zh-CN')

    expect(screen.getByText('APC API Key')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存 Key' })).toBeTruthy()
    expect(screen.getByText('设置已同步。')).toBeTruthy()
    expect(screen.queryByText('Settings synchronized.')).toBeNull()
  })

  it('saves the typed key with settings.keys.add.v1 and lists the answer', async () => {
    const user = userEvent.setup()
    const { service, calls } = makeService((input) =>
      input.operationId === 'settings.keys.add.v1'
        ? view([{ id: ID_ONE, preview: 'apc-****cret', enabled: true }])
        : empty
    )
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    await user.type(screen.getByLabelText('APC API Key'), 'apc-secret')
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    expect(await screen.findByText('Key saved.')).toBeTruthy()
    const add = calls.find((call) => call.operationId === 'settings.keys.add.v1')
    expect(add?.params).toEqual({ apiKey: 'apc-secret' })
    // The field is cleared and the row only shows the masked preview.
    expect((screen.getByLabelText('APC API Key') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('apc-****cret')).toBeTruthy()
    expect(screen.queryByText('apc-secret')).toBeNull()
    expect(screen.getByTestId('api-key-count').textContent).toBe('1 saved')
  })

  it('keeps the typed key out of the rendered document and the row list', async () => {
    const user = userEvent.setup()
    const { service } = makeService(() => view([{ id: ID_ONE, preview: 'apc-****-one', enabled: false }]))
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    const field = screen.getByLabelText('APC API Key') as HTMLInputElement
    await user.type(field, 'apc-secret')
    expect(field.value).toBe('apc-secret')
    // The value lives only in the password field; nothing else renders it.
    expect(screen.queryByText('apc-secret')).toBeNull()
    const textOutsideTheField = Array.from(document.querySelectorAll('p, span, small, strong, li'))
      .map((node) => node.textContent ?? '')
      .join(' ')
    expect(textOutsideTheField).not.toContain('apc-secret')
  })

  it('refuses to add an empty value and keeps the button disabled', async () => {
    const user = userEvent.setup()
    const { service, calls } = makeService()
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    const save = screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await user.click(save)
    expect(calls.filter((call) => call.operationId === 'settings.keys.add.v1')).toHaveLength(0)

    // Whitespace-only input is not a key either.
    await user.type(screen.getByLabelText('APC API Key'), '   ')
    expect(save.disabled).toBe(true)
  })

  it('enables a saved key through settings.keys.enable.v1', async () => {
    const user = userEvent.setup()
    const { service, calls } = makeService((input) =>
      input.operationId === 'settings.keys.enable.v1'
        ? view([
            { id: ID_ONE, preview: 'apc-****-one', enabled: false },
            { id: ID_TWO, preview: 'apc-****-two', enabled: true },
          ])
        : view([
            { id: ID_ONE, preview: 'apc-****-one', enabled: true },
            { id: ID_TWO, preview: 'apc-****-two', enabled: false },
          ])
    )
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    // The already-enabled row cannot be enabled again.
    expect((screen.getByRole('button', { name: 'Enable key apc-****-one' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    await user.click(screen.getByRole('button', { name: 'Enable key apc-****-two' }))

    expect(await screen.findByText('Key enabled.')).toBeTruthy()
    const enable = calls.find((call) => call.operationId === 'settings.keys.enable.v1')
    expect(enable?.params).toEqual({ id: ID_TWO })
    const rows = keyRows()
    expect(rows[0].getAttribute('data-enabled')).toBe('false')
    expect(rows[1].getAttribute('data-enabled')).toBe('true')
  })

  it('deletes a key in one click, with no confirmation step', async () => {
    const user = userEvent.setup()
    const { service, calls } = makeService((input) =>
      input.operationId === 'settings.keys.delete.v1'
        ? view([{ id: ID_TWO, preview: 'apc-****-two', enabled: false }])
        : view([
            { id: ID_ONE, preview: 'apc-****-one', enabled: true },
            { id: ID_TWO, preview: 'apc-****-two', enabled: false },
          ])
    )
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    await user.click(screen.getByRole('button', { name: 'Delete key apc-****-one' }))

    // One click is the whole interaction: no dialog and no second button.
    expect(await screen.findByText('Key deleted.')).toBeTruthy()
    const remove = calls.find((call) => call.operationId === 'settings.keys.delete.v1')
    expect(remove?.params).toEqual({ id: ID_ONE })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull()
    expect(screen.getByText('apc-****-two')).toBeTruthy()
    expect(screen.queryByText('apc-****-one')).toBeNull()
  })

  it('reports a localized failure for each of the three writes', async () => {
    const user = userEvent.setup()
    const failing = makeService((input) => {
      if (input.operationId === 'settings.keys.add.v1') throw new Error('nope')
      return view([{ id: ID_ONE, preview: 'apc-****-one', enabled: false }])
    })
    renderPanel(failing.service, 'zh-CN')
    await screen.findByText('设置已同步。')

    await user.type(screen.getByLabelText('APC API Key'), 'apc-secret')
    await user.click(screen.getByRole('button', { name: '保存 Key' }))
    expect(await screen.findByText('无法保存该 Key。')).toBeTruthy()
  })

  it('reports a localized enable failure and a localized delete failure', async () => {
    const user = userEvent.setup()
    const { service } = makeService((input) => {
      if (input.operationId !== 'settings.get.v2') throw new Error('nope')
      return view([{ id: ID_ONE, preview: 'apc-****-one', enabled: false }])
    })
    renderPanel(service, 'zh-CN')
    await screen.findByText('设置已同步。')

    await user.click(screen.getByRole('button', { name: '启用 Key apc-****-one' }))
    expect(await screen.findByText('无法启用该 Key。')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '删除 Key apc-****-one' }))
    expect(await screen.findByText('无法删除该 Key。')).toBeTruthy()
  })

  it('prevents a second write while one is in flight', async () => {
    const user = userEvent.setup()
    let resolveAdd!: (value: unknown) => void
    const { service, calls } = makeService((input) => {
      if (input.operationId === 'settings.keys.add.v1') {
        return new Promise((resolve) => (resolveAdd = resolve))
      }
      return view([{ id: ID_ONE, preview: 'apc-****-one', enabled: false }])
    })
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    await user.type(screen.getByLabelText('APC API Key'), 'apc-secret')
    const save = screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement
    await user.click(save)
    await waitFor(() => expect(save.disabled).toBe(true))
    // A row action is disabled too while the write is in flight.
    expect((screen.getByRole('button', { name: 'Delete key apc-****-one' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    await user.click(save)

    expect(calls.filter((call) => call.operationId === 'settings.keys.add.v1')).toHaveLength(1)
    resolveAdd(view([{ id: ID_ONE, preview: 'apc-****-one', enabled: true }]))
    await screen.findByText('Key saved.')
  })

  it('shows an explanatory line when no key is saved yet', async () => {
    const { service } = makeService()
    renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    expect(screen.getByTestId('api-key-count').textContent).toBe('No key saved')
    expect(screen.queryByRole('list', { name: 'Saved API Keys' })).toBeNull()
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
    const panel = renderPanel(service, 'en')

    await waitFor(() => expect(captured?.operationId).toBe('settings.get.v2'))
    expect(captured?.signal?.aborted).toBe(false)

    // Leaving the tab unmounts the panel; the request must not outlive it.
    panel.unmount()

    expect(captured?.signal?.aborted).toBe(true)
  })

  it('aborts an in-flight write when the tab is left', async () => {
    const user = userEvent.setup()
    let captured: StoreRequest | undefined
    const { service } = makeService((input) => {
      if (input.operationId === 'settings.keys.add.v1') {
        captured = input
        return new Promise(() => {})
      }
      return empty
    })
    const panel = renderPanel(service, 'en')
    await screen.findByText('Settings synchronized.')

    await user.type(screen.getByLabelText('APC API Key'), 'apc-secret')
    await user.click(screen.getByRole('button', { name: 'Save key' }))
    await waitFor(() => expect(captured?.operationId).toBe('settings.keys.add.v1'))

    panel.unmount()

    expect(captured?.signal?.aborted).toBe(true)
  })
})
