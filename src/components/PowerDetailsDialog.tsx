import { useEffect, useRef } from 'react'
import { INSTALLED_AGENTS, type PowerSeries } from '../api/contracts'
import type { ActiveMutation, InstallationState } from '../api/installationStore'

export interface PowerDetailsDialogProps {
  series: PowerSeries
  selectedVersion: string
  agent: string
  installation: InstallationState
  active?: ActiveMutation
  notice?: string
  onVersionChange(version: string): void
  onAgentChange(agent: string): void
  onInstall(): void
  onUninstall(): void
  onRetry(): void
  onClose(): void
}

const PHASE_LABELS: Record<ActiveMutation['phase'], string> = {
  preflight: '检查中…',
  running: '执行中…',
  reconciling: '确认安装状态…',
}

export function PowerDetailsDialog({
  series,
  selectedVersion,
  agent,
  installation,
  active,
  notice,
  onVersionChange,
  onAgentChange,
  onInstall,
  onUninstall,
  onRetry,
  onClose,
}: PowerDetailsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    if (dialog && !dialog.open && typeof dialog.showModal === 'function') {
      dialog.showModal()
    }
    return () => {
      restoreFocusRef.current?.focus()
    }
  }, [])

  const current = series.versions.find((version) => version.version === selectedVersion) ?? series.versions[0]
  const installedVersion =
    installation.status === 'ready'
      ? installation.records.find(
          (record) => record.agent === agent && record.type === series.type && record.name === series.name
        )?.version
      : undefined
  const isInstalled = installedVersion !== undefined
  const busy = active !== undefined
  const agentOptions = series.type === 'agent' ? ['bibit'] : INSTALLED_AGENTS
  const agentValidForInstall = series.type !== 'agent' || agent === 'bibit'
  const writeEnabled = installation.status === 'ready' && !busy

  const close = () => onClose()

  return (
    <dialog
      ref={dialogRef}
      className="agent-hub-dialog"
      data-power-type={series.type}
      aria-label={series.name}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <div className="agent-hub-dialog__body">
        <header className="agent-hub-dialog__header">
          <div>
            <span className="agent-hub-dialog__type">{series.type}</span>
            <h2>{series.name}</h2>
          </div>
          <button type="button" className="agent-hub-dialog__close" aria-label="Close" onClick={close}>
            ×
          </button>
        </header>

        <div className="agent-hub-dialog__field">
          <span className="agent-hub-dialog__label">Agent</span>
          {series.type === 'agent' && agent !== 'bibit' ? (
            <div>
              <p className="agent-hub-dialog__hint">该类型仅支持 bibit Agent。</p>
              <button type="button" disabled={busy} onClick={() => onAgentChange('bibit')}>
                切换到 bibit
              </button>
            </div>
          ) : (
            <select
              aria-label="Agent"
              value={agent}
              disabled={busy || isInstalled}
              onChange={(event) => onAgentChange(event.target.value)}
            >
              {agentOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="agent-hub-dialog__field">
          <span className="agent-hub-dialog__label">Version</span>
          <select
            aria-label="Version"
            value={current.version}
            disabled={busy || isInstalled}
            onChange={(event) => onVersionChange(event.target.value)}
          >
            {series.versions.map((version) => (
              <option key={version.version} value={version.version}>
                {version.version}
              </option>
            ))}
          </select>
        </div>

        <p className="agent-hub-dialog__description">{current.description}</p>
        <div className="agent-hub-dialog__tags" data-testid="dialog-tags">
          {current.tags.map((tag) => (
            <span key={tag} className="power-card__tag">
              {tag}
            </span>
          ))}
        </div>

        <div className="agent-hub-dialog__status">
          {installation.status === 'unknown' && <p role="status">正在读取安装状态…</p>}
          {installation.status === 'checking' && <p role="status">检查中…</p>}
          {installation.status === 'error' && (
            <div role="alert">
              <span>{installation.message}</span>
              <button type="button" onClick={onRetry}>
                Retry
              </button>
            </div>
          )}
          {installation.status === 'ready' && !isInstalled && <p role="status">未安装</p>}
          {installation.status === 'ready' && isInstalled && <p role="status">已安装 {installedVersion}</p>}
          {busy && active && <p role="status">{PHASE_LABELS[active.phase]}</p>}
          {notice && !busy && (
            <p className="agent-hub-dialog__notice" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
      <footer className="agent-hub-dialog__footer">
        <button type="button" className="agent-hub-dialog__cancel" onClick={close}>
          关闭
        </button>
        {installation.status === 'ready' && !isInstalled && agentValidForInstall && (
          <button type="button" className="agent-hub-dialog__install" disabled={!writeEnabled} onClick={onInstall}>
            安装
          </button>
        )}
        {installation.status === 'ready' && isInstalled && (
          <button type="button" className="agent-hub-dialog__uninstall" disabled={!writeEnabled} onClick={onUninstall}>
            卸载
          </button>
        )}
      </footer>
    </dialog>
  )
}
