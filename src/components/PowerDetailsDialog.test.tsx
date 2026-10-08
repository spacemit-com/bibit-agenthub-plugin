import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PowerSeries } from '../api/contracts'
import type { APMPowerRecord } from '../api/apm'
import { PowerDetailsDialog } from './PowerDetailsDialog'
import { AgentHubI18nProvider } from '../agentHubI18n'

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

afterEach(cleanup)

const series: PowerSeries = {
  type: 'skill',
  name: 'code-review',
  versions: [
    { version: 'v2.0.0', description: 'Peer review with a quality gate.', tags: ['code-review', 'quality'] },
    { version: 'v1.0.0', description: 'Peer review workflow.', tags: ['writing'] },
  ],
}

const record = (version: string): APMPowerRecord => ({
  agent: 'bibit',
  type: 'skill',
  name: 'code-review',
  version,
  description: '',
  tags: [],
})

const localizedSeries: PowerSeries = {
  type: 'skill',
  name: 'code-review',
  name_zh: '代码审查',
  name_en: 'Code Review',
  versions: [
    {
      version: 'v2.0.0',
      description: 'Peer review with a quality gate.',
      tags: ['quality'],
      description_zh: '带质量门禁的代码审查。',
    },
    { version: 'v1.0.0', description: 'Peer review workflow.', tags: ['writing'] },
  ],
}

const props = {
  series,
  selectedVersion: 'v2.0.0',
  agent: 'bibit',
  installation: { status: 'ready' as const, records: [] as APMPowerRecord[] },
  readOnly: false,
  onVersionChange: vi.fn(),
  onInstall: vi.fn(),
  onUninstall: vi.fn(),
  onRetry: vi.fn(),
  onClose: vi.fn(),
}

describe('PowerDetailsDialog', () => {
  it('switches every dialog label and status with the host language prop', async () => {
    const dialog = (language: string) => (
      <AgentHubI18nProvider language={language}>
        <PowerDetailsDialog {...props} />
      </AgentHubI18nProvider>
    )
    const view = render(dialog('en'))

    expect(await screen.findByText('Not installed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.getByText('Version')).toBeTruthy()
    expect(screen.getByText('Agent')).toBeTruthy()

    view.rerender(dialog('zh-CN'))

    expect(screen.getByText('未安装')).toBeTruthy()
    expect(screen.getByRole('button', { name: '安装' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy()
    expect(screen.getByText('版本')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })


  it.each(['skill', 'plugin', 'mcp'] as const)('shows the Agent read-only for a %s Power', (type) => {
    render(<PowerDetailsDialog {...props} series={{ ...series, type }} agent="hermes-agent" />)

    expect(screen.getByTestId('dialog-agent-static').textContent).toBe('hermes-agent')
    // The Agent is chosen once, in the tab row's control; the modal has no chooser.
    expect(screen.queryByLabelText('Agent')).toBeNull()
  })

  it('shows the selected version description and tags', () => {
    render(<PowerDetailsDialog {...props} />)

    expect(screen.getByText('Peer review with a quality gate.')).toBeTruthy()
    const tags = screen.getByTestId('dialog-tags')
    expect(within(tags).getByText('quality')).toBeTruthy()
    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('v2.0.0')
  })

  it('shows the Chinese display name and description for a Chinese host', () => {
    render(
      <AgentHubI18nProvider language="zh-CN">
        <PowerDetailsDialog {...props} series={localizedSeries} />
      </AgentHubI18nProvider>
    )

    expect(screen.getByRole('heading', { name: '代码审查' })).toBeTruthy()
    expect(screen.getByText('带质量门禁的代码审查。')).toBeTruthy()
    // The dialog's accessible name follows the same resolved title as the heading.
    expect(document.querySelector('dialog')?.getAttribute('aria-label')).toBe('代码审查')
  })

  it('shows the English display name and source description for an English host', () => {
    render(
      <AgentHubI18nProvider language="en">
        <PowerDetailsDialog {...props} series={localizedSeries} />
      </AgentHubI18nProvider>
    )

    expect(screen.getByRole('heading', { name: 'Code Review' })).toBeTruthy()
    expect(screen.getByText('Peer review with a quality gate.')).toBeTruthy()
    expect(screen.queryByText('带质量门禁的代码审查。')).toBeNull()
    expect(document.querySelector('dialog')?.getAttribute('aria-label')).toBe('Code Review')
  })

  it('falls back to the canonical name and source description for a V1 series', () => {
    render(
      <AgentHubI18nProvider language="zh-CN">
        <PowerDetailsDialog {...props} />
      </AgentHubI18nProvider>
    )

    expect(screen.getByRole('heading', { name: 'code-review' })).toBeTruthy()
    expect(screen.getByText('Peer review with a quality gate.')).toBeTruthy()
  })

  it('updates the description and tags when the version changes', async () => {
    const user = userEvent.setup()
    const onVersionChange = vi.fn()
    render(<PowerDetailsDialog {...props} onVersionChange={onVersionChange} />)

    await user.selectOptions(screen.getByLabelText('Version'), 'v1.0.0')

    expect(onVersionChange).toHaveBeenCalledWith('v1.0.0')
  })

  it('offers Uninstall when the selected version is the installed one', () => {
    render(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    expect(screen.getByText('Installed v1.0.0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
    // Being installed is what the user acts on now, so it must not lock the choice.
    expect((screen.getByLabelText('Version') as HTMLSelectElement).disabled).toBe(false)
  })

  it('names the action after what the chosen version does to the installed one', () => {
    const { rerender } = render(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v2.0.0"
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    // v2 chosen over an installed v1.
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()

    rerender(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        installation={{ status: 'ready', records: [record('v2.0.0')] }}
      />
    )

    // v1 chosen over an installed v2.
    expect(screen.getByRole('button', { name: 'Downgrade' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })

  it('marks the installed version in the version options', () => {
    render(
      <PowerDetailsDialog
        {...props}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    const options = Array.from((screen.getByLabelText('Version') as HTMLSelectElement).options)
    expect(options.map((option) => option.textContent)).toEqual(['v2.0.0', 'v1.0.0 (installed)'])
  })

  it('keeps the installed version selectable when the catalog dropped it', () => {
    // Uninstalling is only reachable by selecting the installed version, so an
    // unpublished version still has to appear in the list.
    render(
      <PowerDetailsDialog
        {...props}
        installation={{ status: 'ready', records: [record('v3.0.0')] }}
      />
    )

    const options = Array.from((screen.getByLabelText('Version') as HTMLSelectElement).options)
    expect(options.map((option) => option.textContent)).toEqual([
      'v3.0.0 (installed)',
      'v2.0.0',
      'v1.0.0',
    ])
  })

  it('restores install and enables the version select after the record is gone', () => {
    const { rerender } = render(
      <PowerDetailsDialog
        {...props}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    rerender(
      <PowerDetailsDialog {...props} installation={{ status: 'ready', records: [] }} />
    )

    expect(screen.getByText('Not installed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
    expect((screen.getByLabelText('Version') as HTMLSelectElement).disabled).toBe(false)
  })

  it('locks the version and hides install when readOnly even if not installed', () => {
    render(<PowerDetailsDialog {...props} readOnly installation={{ status: 'ready', records: [] }} />)

    expect((screen.getByLabelText('Version') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
  })

  it('keeps the uninstall action while readOnly with an installed record', () => {
    render(
      <PowerDetailsDialog
        {...props}
        readOnly
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    expect((screen.getByLabelText('Version') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('has no footer when there is no install or uninstall action', () => {
    render(<PowerDetailsDialog {...props} installation={{ status: 'checking' }} />)

    expect(document.querySelector('.agent-hub-dialog__footer')).toBeNull()
  })

  it.each([
    ['unknown', { status: 'unknown' as const }],
    ['checking', { status: 'checking' as const }],
    ['error', { status: 'error' as const, message: { text: 'Refresh failed; the installed state could not be confirmed.' } }],
  ])('disables writes while installation is %s', (_label, installation) => {
    render(<PowerDetailsDialog {...props} installation={installation} />)

    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
  })

  it('offers Retry and hides writes on error', () => {
    render(
      <PowerDetailsDialog
        {...props}
        installation={{ status: 'error', message: { text: 'Refresh failed; the installed state could not be confirmed.' } }}
      />
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it.each(['codex', 'hermes-agent'])('only explains that an %s target cannot take agent-type Powers', (agent) => {
    const agentSeries: PowerSeries = {
      type: 'agent',
      name: 'reviewer',
      versions: [{ version: 'v1.0.0', description: 'Agent reviewer.', tags: [] }],
    }
    render(<PowerDetailsDialog {...props} series={agentSeries} agent={agent} />)

    expect(screen.getByText('Only the bibit agent supports this type.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    // No corrective Agent control either: the tab row owns that choice.
    expect(screen.queryByRole('button', { name: 'Switch to bibit' })).toBeNull()
    expect(screen.queryByLabelText('Agent')).toBeNull()
    expect(screen.getByTestId('dialog-agent-static').textContent).toBe(agent)
  })

  it('shows the active phase and disables writes while busy', () => {
    render(
      <PowerDetailsDialog
        {...props}
        active={{ intent: { kind: 'install', input: { agent: 'bibit', type: 'skill', name: 'code-review', version: 'v2.0.0' } }, phase: 'running' }}
      />
    )

    expect(screen.getByText('Running…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the notice when not busy', () => {
    render(<PowerDetailsDialog {...props} notice={{ text: 'Installation complete.' }} />)

    expect(screen.getByText('Installation complete.')).toBeTruthy()
  })

  it('closes on Escape via the cancel event', () => {
    const onClose = vi.fn()
    render(<PowerDetailsDialog {...props} onClose={onClose} />)

    const dialog = document.querySelector('dialog')
    expect(dialog).toBeTruthy()
    fireEvent(dialog as HTMLElement, new Event('cancel', { cancelable: true }))

    expect(onClose).toHaveBeenCalled()
  })

  it('closes from the close button without rendering a footer cancel button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PowerDetailsDialog {...props} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalled()
    // The header × is the only close affordance; no footer cancel button is added.
    const closeButtons = screen.getAllByRole('button', { name: 'Close' })
    expect(closeButtons).toHaveLength(1)
    expect(closeButtons[0]).toBe(
      document.querySelector('.agent-hub-dialog__header .agent-hub-dialog__close')
    )
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('installs directly, while update, downgrade and uninstall confirm first', async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    const onUninstall = vi.fn()
    const renderWith = (overrides: Partial<typeof props> & { installation: typeof props.installation }) =>
      render(
        <PowerDetailsDialog
          {...props}
          onInstall={onInstall}
          onUninstall={onUninstall}
          {...overrides}
        />
      )
    const { rerender } = renderWith({ installation: { status: 'ready', records: [] } })

    // A first install has nothing to replace, so it stays a single click.
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(onInstall).toHaveBeenCalledTimes(1)

    // Replacing does: the selected v2 replaces an installed v1 only after confirming.
    rerender(
      <PowerDetailsDialog
        {...props}
        onInstall={onInstall}
        onUninstall={onUninstall}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Update this Power?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirm update' }))
    expect(onInstall).toHaveBeenCalledTimes(2)

    // Going backwards confirms too.
    rerender(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        onInstall={onInstall}
        onUninstall={onUninstall}
        installation={{ status: 'ready', records: [record('v2.0.0')] }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Downgrade' }))
    expect(onInstall).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Downgrade this Power?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirm downgrade' }))
    expect(onInstall).toHaveBeenCalledTimes(3)

    // Uninstalling keeps its own confirmation.
    rerender(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        onInstall={onInstall}
        onUninstall={onUninstall}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect(onUninstall).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm uninstall' }))
    expect(onUninstall).toHaveBeenCalledTimes(1)
  })

  it('drops a primed confirmation when the version changes under it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect(screen.getByText('Uninstall this Power?')).toBeTruthy()

    rerender(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v2.0.0"
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    // The confirmation named the old action, so it cannot stay primed on the new one.
    expect(screen.queryByText('Uninstall this Power?')).toBeNull()
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })

  it('names the exact target in the uninstall confirmation', async () => {
    const user = userEvent.setup()
    render(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Uninstall' }))

    // The confirmation pins agent/type/name and uses the canonical name, which is
    // what the request actually carries.
    expect(
      screen.getByText('Removes skill "code-review" for bibit.')
    ).toBeTruthy()
    expect(document.querySelector('.agent-hub-dialog__confirm')?.getAttribute('role')).toBe('alertdialog')
  })

  it('shows the agent type as Expert in the badge and the confirmations', async () => {
    const user = userEvent.setup()
    const agentSeries: PowerSeries = {
      type: 'agent',
      name: 'reviewer',
      versions: [{ version: 'v1.0.0', description: 'Agent reviewer.', tags: [] }],
    }
    render(
      <PowerDetailsDialog
        {...props}
        series={agentSeries}
        selectedVersion="v1.0.0"
        installation={{
          status: 'ready',
          records: [{ agent: 'bibit', type: 'agent', name: 'reviewer', version: 'v1.0.0', description: '', tags: [] }],
        }}
      />
    )

    expect(document.querySelector('.agent-hub-dialog__type')?.textContent).toBe('Expert')

    await user.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect(screen.getByText('Removes Expert "reviewer" for bibit.')).toBeTruthy()
  })

  it('cancels the uninstall confirmation without calling the handler', async () => {
    const user = userEvent.setup()
    const onUninstall = vi.fn()
    render(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        onUninstall={onUninstall}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Uninstall' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onUninstall).not.toHaveBeenCalled()
    expect(screen.queryByText('Uninstall this Power?')).toBeNull()
    // Back to the plain action, still available.
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeTruthy()
  })

  it('locks the uninstall confirmation while a mutation is busy', async () => {
    const user = userEvent.setup()
    const onUninstall = vi.fn()
    const { rerender } = render(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        onUninstall={onUninstall}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Uninstall' }))
    const confirm = screen.getByRole('button', { name: 'Confirm uninstall' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)

    // A write in flight disables the footer actions, so a second submit is
    // impossible from the UI.
    rerender(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        onUninstall={onUninstall}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
        active={{ intent: { kind: 'uninstall', input: { agent: 'bibit', type: 'skill', name: 'code-review' } }, phase: 'running' }}
      />
    )

    expect((screen.getByRole('button', { name: 'Confirm uninstall' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Confirm uninstall' }))
    expect(onUninstall).not.toHaveBeenCalled()
  })

  it('drops primed in-dialog state when the dialog switches Power', async () => {
    const user = userEvent.setup()
    const uninstalled = () => ({
      ...record('v1.0.0'),
      name: 'other-skill',
    })
    const { rerender } = render(
      <PowerDetailsDialog
        {...props}
        selectedVersion="v1.0.0"
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect(screen.getByText('Uninstall this Power?')).toBeTruthy()

    // The page reuses the same dialog instance for the next Power. Installing on
    // the new target still shows the footer, so the assertion is about the primed
    // confirmation rather than about the footer disappearing.
    rerender(
      <PowerDetailsDialog
        {...props}
        series={{ ...series, name: 'other-skill' }}
        selectedVersion="v1.0.0"
        installation={{ status: 'ready', records: [uninstalled()] }}
      />
    )

    expect(screen.queryByText('Uninstall this Power?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm uninstall' })).toBeNull()
    // The new Power's own action is present and still unarmed.
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeTruthy()
  })
})

describe('PowerDetailsDialog custom resources', () => {
  const customSeries: PowerSeries = {
    type: 'skill',
    name: 'hand-written',
    source: 'custom',
    versions: [{ version: '', description: 'Hand made.', tags: [] }],
  }

  const customProps = {
    ...props,
    series: customSeries,
    selectedVersion: '',
    installation: { status: 'ready' as const, records: [] as APMPowerRecord[] },
    customNotice: undefined,
  }

  it('shows directory facts and the two custom actions instead of the APM lifecycle', () => {
    const view = render(<PowerDetailsDialog {...customProps} />)

    expect(screen.getByText('Custom')).toBeTruthy()
    expect(screen.getByText('Installed outside Agent Hub; not managed by APM.')).toBeTruthy()
    expect(screen.getByTestId('dialog-agent-static').textContent).toBe('bibit')
    expect(screen.getByTestId('dialog-version-static').textContent).toBe('No version')
    // No APM install state and no install/uninstall pair for a hand-installed resource.
    expect(screen.queryByText('Not installed')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
    expect(view.container.querySelector('dialog')?.getAttribute('data-source')).toBe('custom')
  })

  it('requires a non-blank message before uploading, then reports it upward', async () => {
    const user = userEvent.setup()
    const onUpload = vi.fn()
    render(<PowerDetailsDialog {...customProps} onUpload={onUpload} onDelete={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Upload' }))
    const submit = screen.getByRole('button', { name: 'Upload to APC' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    await user.type(screen.getByLabelText('Publish message'), 'Publish the local demo skill')
    expect(submit.disabled).toBe(false)
    await user.click(submit)

    expect(onUpload).toHaveBeenCalledWith('Publish the local demo skill')
    // The inline form closes and its text does not linger.
    expect(screen.queryByLabelText('Publish message')).toBeNull()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy()
  })

  it('does not upload a whitespace-only message', async () => {
    const user = userEvent.setup()
    const onUpload = vi.fn()
    render(<PowerDetailsDialog {...customProps} onUpload={onUpload} />)

    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await user.type(screen.getByLabelText('Publish message'), '   ')

    expect((screen.getByRole('button', { name: 'Upload to APC' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('confirms before deleting and can be cancelled', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<PowerDetailsDialog {...customProps} onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete this resource?')).toBeTruthy()
    // The confirm copy names the exact directory that will be removed.
    expect(
      screen.getByText('Removes the local skill "hand-written" for bibit. This cannot be undone.')
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete this resource?')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('disables both actions and shows the phase while a write is in flight', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PowerDetailsDialog {...customProps} onUpload={vi.fn()} onDelete={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Upload' }))
    rerender(
      <PowerDetailsDialog
        {...customProps}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        customAction={{ kind: 'upload', phase: 'running' }}
      />
    )

    expect(screen.getByText('Uploading…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Upload to APC' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(
      <PowerDetailsDialog
        {...customProps}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        customAction={{ kind: 'delete', phase: 'reconciling' }}
      />
    )
    expect(screen.getByText('Confirming installation state…')).toBeTruthy()
  })

  it('renders the custom notice and translates it', () => {
    const notice = { text: 'Upload complete: {submissionId}', values: { submissionId: 'sub_1' } }
    const view = render(
      <AgentHubI18nProvider language="en">
        <PowerDetailsDialog {...customProps} customNotice={notice} />
      </AgentHubI18nProvider>
    )
    expect(screen.getByText('Upload complete: sub_1')).toBeTruthy()

    view.rerender(
      <AgentHubI18nProvider language="zh-CN">
        <PowerDetailsDialog {...customProps} customNotice={notice} />
      </AgentHubI18nProvider>
    )
    expect(screen.getByText('上传完成：sub_1')).toBeTruthy()
  })

  it('switches the custom actions with the host language', () => {
    render(
      <AgentHubI18nProvider language="zh-CN">
        <PowerDetailsDialog {...customProps} onUpload={vi.fn()} onDelete={vi.fn()} />
      </AgentHubI18nProvider>
    )

    expect(screen.getByRole('button', { name: '上传' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy()
    expect(screen.getByText('自定义')).toBeTruthy()
  })
})
