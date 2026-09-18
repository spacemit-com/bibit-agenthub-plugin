import { useEffect, useRef } from 'react'
import { ScrollThumb } from '../ScrollThumb'
import { useAgentHubI18n, type TranslatableText } from '../agentHubI18n'
import { INSTALLED_AGENTS, type PowerSeries } from '../api/contracts'
import type { ActiveMutation, InstallationState } from '../api/installationStore'

export interface PowerDetailsDialogProps {
  series: PowerSeries
  selectedVersion: string
  agent: string
  installation: InstallationState
  active?: ActiveMutation
  notice?: TranslatableText
  readOnly: boolean
  onVersionChange(version: string): void
  onAgentChange(agent: string): void
  onInstall(): void
  onUninstall(): void
  onRetry(): void
  onClose(): void
}

// English source text for each mutation phase; translated where it renders.
const PHASE_LABELS: Record<ActiveMutation['phase'], string> = {
  preflight: 'Checking…',
  running: 'Running…',
  reconciling: 'Confirming installation state…',
}

export function PowerDetailsDialog({
  series,
  selectedVersion,
  agent,
  installation,
  active,
  notice,
  readOnly,
  onVersionChange,
  onAgentChange,
  onInstall,
  onUninstall,
  onRetry,
  onClose,
}: PowerDetailsDialogProps) {
  const t = useAgentHubI18n()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
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
  // APM supports skill/plugin/mcp for every listed target, including Hermes.
  const agentOptions = series.type === 'agent' ? ['bibit'] : INSTALLED_AGENTS
  const agentValidForInstall = series.type !== 'agent' || agent === 'bibit'
  const targetLocked = busy || isInstalled || readOnly
  const writeEnabled = installation.status === 'ready' && !busy
  const showInstall = installation.status === 'ready' && !isInstalled && agentValidForInstall && !readOnly
  const showUninstall = installation.status === 'ready' && isInstalled

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
      <div className="agent-hub-dialog__body" ref={bodyRef}>
        <header className="agent-hub-dialog__header">
          <div>
            <span className="agent-hub-dialog__type">{series.type}</span>
            <h2>{series.name}</h2>
          </div>
          <button type="button" className="agent-hub-dialog__close" aria-label={t('Close')} onClick={close}>
            ×
          </button>
        </header>

        <div className="agent-hub-dialog__field">
          <span className="agent-hub-dialog__label">{t('Agent')}</span>
          {series.type === 'agent' && agent !== 'bibit' ? (
            <div>
              <p className="agent-hub-dialog__hint">{t('Only the bibit agent supports this type.')}</p>
              <button type="button" disabled={targetLocked} onClick={() => onAgentChange('bibit')}>
                {t('Switch to bibit')}
              </button>
            </div>
          ) : (
            <select
              aria-label={t('Agent')}
              value={agent}
              disabled={targetLocked}
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
          <span className="agent-hub-dialog__label">{t('Version')}</span>
          <select
            aria-label={t('Version')}
            value={current.version}
            disabled={targetLocked}
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
          {installation.status === 'unknown' && (
            <p role="status">{t('Reading installation state…')}</p>
          )}
          {installation.status === 'checking' && <p role="status">{t('Checking…')}</p>}
          {installation.status === 'error' && (
            <div role="alert">
              <span>{t(installation.message.text, installation.message.values)}</span>
              <button type="button" onClick={onRetry}>
                {t('Retry')}
              </button>
            </div>
          )}
          {installation.status === 'ready' && !isInstalled && (
            <p role="status">{t('Not installed')}</p>
          )}
          {installation.status === 'ready' && isInstalled && (
            <p role="status">
              {/* The version is data, so only the label sentence is translated. */}
              {t('Installed {version}', { version: installedVersion ?? '' })}
            </p>
          )}
          {busy && active && <p role="status">{t(PHASE_LABELS[active.phase])}</p>}
          {notice && !busy && (
            <p className="agent-hub-dialog__notice" role="status">
              {t(notice.text, notice.values)}
            </p>
          )}
        </div>
        <ScrollThumb targetRef={bodyRef} />
      </div>
      {(showInstall || showUninstall) && (
        <footer className="agent-hub-dialog__footer">
          {showInstall && (
            <button type="button" className="agent-hub-dialog__install" disabled={!writeEnabled} onClick={onInstall}>
              {t('Install')}
            </button>
          )}
          {showUninstall && (
            <button type="button" className="agent-hub-dialog__uninstall" disabled={!writeEnabled} onClick={onUninstall}>
              {t('Uninstall')}
            </button>
          )}
        </footer>
      )}
    </dialog>
  )
}
