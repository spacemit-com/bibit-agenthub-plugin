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

const props = {
  series,
  selectedVersion: 'v2.0.0',
  agent: 'bibit',
  installation: { status: 'ready' as const, records: [] as APMPowerRecord[] },
  readOnly: false,
  onVersionChange: vi.fn(),
  onAgentChange: vi.fn(),
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


  it.each(['skill', 'plugin', 'mcp'] as const)('offers Hermes as the %s install target', async (type) => {
    const onAgentChange = vi.fn()
    render(<PowerDetailsDialog {...props} series={{ ...series, type }} onAgentChange={onAgentChange} />)
    await userEvent.setup().selectOptions(screen.getByLabelText('Agent'), 'hermes-agent')
    expect(onAgentChange).toHaveBeenCalledWith('hermes-agent')
  })

  it('shows the selected version description and tags', () => {
    render(<PowerDetailsDialog {...props} />)

    expect(screen.getByText('Peer review with a quality gate.')).toBeTruthy()
    const tags = screen.getByTestId('dialog-tags')
    expect(within(tags).getByText('quality')).toBeTruthy()
    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('v2.0.0')
  })

  it('updates the description and tags when the version changes', async () => {
    const user = userEvent.setup()
    const onVersionChange = vi.fn()
    render(<PowerDetailsDialog {...props} onVersionChange={onVersionChange} />)

    await user.selectOptions(screen.getByLabelText('Version'), 'v1.0.0')

    expect(onVersionChange).toHaveBeenCalledWith('v1.0.0')
  })

  it('shows the installed version with uninstall only and disables the version select', () => {
    render(
      <PowerDetailsDialog
        {...props}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )

    expect(screen.getByText('Installed v1.0.0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect((screen.getByLabelText('Version') as HTMLSelectElement).disabled).toBe(true)
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

  it('locks agent and version and hides install when readOnly even if not installed', () => {
    render(<PowerDetailsDialog {...props} readOnly installation={{ status: 'ready', records: [] }} />)

    expect((screen.getByLabelText('Agent') as HTMLSelectElement).disabled).toBe(true)
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

    expect((screen.getByLabelText('Agent') as HTMLSelectElement).disabled).toBe(true)
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

  it.each(['codex', 'hermes-agent'])('offers only a Bibit switch for %s agent-type powers', (agent) => {
    const agentSeries: PowerSeries = {
      type: 'agent',
      name: 'reviewer',
      versions: [{ version: 'v1.0.0', description: 'Agent reviewer.', tags: [] }],
    }
    render(<PowerDetailsDialog {...props} series={agentSeries} agent={agent} />)

    expect(screen.getByText('Only the bibit agent supports this type.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Switch to bibit' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
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

  it('calls install and uninstall handlers', async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    const onUninstall = vi.fn()
    const { rerender } = render(
      <PowerDetailsDialog
        {...props}
        onInstall={onInstall}
        onUninstall={onUninstall}
        installation={{ status: 'ready', records: [] }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(onInstall).toHaveBeenCalled()

    rerender(
      <PowerDetailsDialog
        {...props}
        onInstall={onInstall}
        onUninstall={onUninstall}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect(onUninstall).toHaveBeenCalled()
  })
})
