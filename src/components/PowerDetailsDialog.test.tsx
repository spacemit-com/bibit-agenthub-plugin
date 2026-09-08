import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PowerSeries } from '../api/contracts'
import type { APMPowerRecord } from '../api/apm'
import { PowerDetailsDialog } from './PowerDetailsDialog'

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
  onVersionChange: vi.fn(),
  onAgentChange: vi.fn(),
  onInstall: vi.fn(),
  onUninstall: vi.fn(),
  onRetry: vi.fn(),
  onClose: vi.fn(),
}

describe('PowerDetailsDialog', () => {
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

    expect(screen.getByText('已安装 v1.0.0')).toBeTruthy()
    expect(screen.getByRole('button', { name: '卸载' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull()
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

    expect(screen.getByText('未安装')).toBeTruthy()
    expect(screen.getByRole('button', { name: '安装' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '卸载' })).toBeNull()
    expect((screen.getByLabelText('Version') as HTMLSelectElement).disabled).toBe(false)
  })

  it.each([
    ['unknown', { status: 'unknown' as const }],
    ['checking', { status: 'checking' as const }],
    ['error', { status: 'error' as const, message: '刷新失败，无法确认安装状态' }],
  ])('disables writes while installation is %s', (_label, installation) => {
    render(<PowerDetailsDialog {...props} installation={installation} />)

    expect(screen.queryByRole('button', { name: '安装' })).toBeNull()
    expect(screen.queryByRole('button', { name: '卸载' })).toBeNull()
  })

  it('offers Retry and hides writes on error', () => {
    render(
      <PowerDetailsDialog
        {...props}
        installation={{ status: 'error', message: '刷新失败，无法确认安装状态' }}
      />
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull()
  })

  it('offers only an explicit switch for a non-bibit agent-type power', () => {
    const agentSeries: PowerSeries = {
      type: 'agent',
      name: 'reviewer',
      versions: [{ version: 'v1.0.0', description: 'Agent reviewer.', tags: [] }],
    }
    render(<PowerDetailsDialog {...props} series={agentSeries} agent="codex" />)

    expect(screen.getByText('该类型仅支持 bibit Agent。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '切换到 bibit' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull()
  })

  it('shows the active phase and disables writes while busy', () => {
    render(
      <PowerDetailsDialog
        {...props}
        active={{ intent: { kind: 'install', input: { agent: 'bibit', type: 'skill', name: 'code-review', version: 'v2.0.0' } }, phase: 'running' }}
      />
    )

    expect(screen.getByText('执行中…')).toBeTruthy()
    expect((screen.getByRole('button', { name: '安装' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the notice when not busy', () => {
    render(<PowerDetailsDialog {...props} notice="安装完成" />)

    expect(screen.getByText('安装完成')).toBeTruthy()
  })

  it('closes on Escape via the cancel event', () => {
    const onClose = vi.fn()
    render(<PowerDetailsDialog {...props} onClose={onClose} />)

    const dialog = document.querySelector('dialog')
    expect(dialog).toBeTruthy()
    fireEvent(dialog as HTMLElement, new Event('cancel', { cancelable: true }))

    expect(onClose).toHaveBeenCalled()
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

    await user.click(screen.getByRole('button', { name: '安装' }))
    expect(onInstall).toHaveBeenCalled()

    rerender(
      <PowerDetailsDialog
        {...props}
        onInstall={onInstall}
        onUninstall={onUninstall}
        installation={{ status: 'ready', records: [record('v1.0.0')] }}
      />
    )
    await user.click(screen.getByRole('button', { name: '卸载' }))
    expect(onUninstall).toHaveBeenCalled()
  })
})
