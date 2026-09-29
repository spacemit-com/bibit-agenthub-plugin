import { useEffect, useRef, useState } from 'react'
import { ScrollThumb } from '../ScrollThumb'
import { useAgentHubI18n, useAgentHubLanguage, type TranslatableText } from '../agentHubI18n'
import { resolvePowerDescription, resolvePowerTitle } from '../displayFields'
import { INSTALLED_AGENTS, type PowerSeries } from '../api/contracts'
import type { ActiveMutation, InstallationState } from '../api/installationStore'

/** A custom-resource write in flight; both custom actions disable while it runs. */
export interface CustomActionState {
  kind: 'upload' | 'delete'
  phase: 'running' | 'reconciling'
}

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
  /** In-flight custom write for this resource, if any. */
  customAction?: CustomActionState
  /** Result of the last custom write for this resource. */
  customNotice?: TranslatableText
  onUpload?(message: string): void
  onDelete?(): void
}

// English source text for each mutation phase; translated where it renders.
const PHASE_LABELS: Record<ActiveMutation['phase'], string> = {
  preflight: 'Checking…',
  running: 'Running…',
  reconciling: 'Confirming installation state…',
}

const CUSTOM_PHASE_LABELS: Record<CustomActionState['kind'], Record<CustomActionState['phase'], string>> = {
  upload: { running: 'Uploading…', reconciling: 'Confirming installation state…' },
  delete: { running: 'Deleting…', reconciling: 'Confirming installation state…' },
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
  customAction,
  customNotice,
  onUpload,
  onDelete,
}: PowerDetailsDialogProps) {
  const t = useAgentHubI18n()
  const language = useAgentHubLanguage()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // The inline upload form and the delete confirmation are transient dialog state:
  // closing the dialog drops them, so a half-typed message never leaks into the
  // next resource the user opens.
  const [customForm, setCustomForm] = useState<'none' | 'upload' | 'delete'>('none')
  const [publishMessage, setPublishMessage] = useState('')
  // Uninstall is destructive, so it is a two-step action like the custom delete.
  // Leaving the dialog drops the confirmation, so reopening a Power never starts
  // on a primed destructive button.
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)

  // The dialog is reused across Powers without a remount (the page swaps `series`),
  // so transient action state has to be reset when the target changes.
  useEffect(() => {
    setCustomForm('none')
    setPublishMessage('')
    setConfirmingUninstall(false)
  }, [series.type, series.name, agent])

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
  // Display-only text: the canonical `series.name` still identifies the Power in
  // every record lookup and request below.
  const title = resolvePowerTitle(series, language)
  const description = resolvePowerDescription(current, language)
  // A hand-installed resource is not managed by Agent Hub, so the APM install
  // facts do not apply to it: the dialog shows the directory facts and the two
  // custom actions instead of an install/uninstall pair.
  const custom = series.source === 'custom'
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
  const customBusy = customAction !== undefined
  const messageValid = publishMessage.trim().length > 0 && publishMessage.length <= 200

  const close = () => onClose()

  const submitUpload = () => {
    if (!messageValid || customBusy || !onUpload) return
    onUpload(publishMessage.trim())
    setCustomForm('none')
    setPublishMessage('')
  }

  const confirmDelete = () => {
    if (customBusy || !onDelete) return
    onDelete()
    setCustomForm('none')
  }

  const confirmUninstall = () => {
    if (!writeEnabled || !onUninstall) return
    onUninstall()
    setConfirmingUninstall(false)
  }

  return (
    <dialog
      ref={dialogRef}
      className="agent-hub-dialog"
      data-power-type={series.type}
      data-source={custom ? 'custom' : undefined}
      aria-label={title}      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <div className="agent-hub-dialog__body" ref={bodyRef}>
        <header className="agent-hub-dialog__header">
          <div>
            <span className="agent-hub-dialog__type">{series.type}</span>
            {custom && <span className="power-card__badge">{t('Custom')}</span>}
            <h2>{title}</h2>
          </div>
          <button type="button" className="agent-hub-dialog__close" aria-label={t('Close')} onClick={close}>
            ×
          </button>
        </header>

        {custom && <p className="agent-hub-dialog__hint">{t('Installed outside Agent Hub; not managed by APM.')}</p>}

        <div className="agent-hub-dialog__field">
          <span className="agent-hub-dialog__label">{t('Agent')}</span>
          {custom ? (
            <span data-testid="dialog-agent-static">{agent}</span>
          ) : series.type === 'agent' && agent !== 'bibit' ? (
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
          {custom ? (
            <span data-testid="dialog-version-static">{current.version || t('No version')}</span>
          ) : (
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
          )}
        </div>

        <p className="agent-hub-dialog__description">{description}</p>
        <div className="agent-hub-dialog__tags" data-testid="dialog-tags">
          {current.tags.map((tag) => (
            <span key={tag} className="power-card__tag">
              {tag}
            </span>
          ))}
        </div>

        <div className="agent-hub-dialog__status">
          {!custom && installation.status === 'unknown' && (
            <p role="status">{t('Reading installation state…')}</p>
          )}
          {!custom && installation.status === 'checking' && <p role="status">{t('Checking…')}</p>}
          {!custom && installation.status === 'error' && (
            <div role="alert">
              <span>{t(installation.message.text, installation.message.values)}</span>
              <button type="button" onClick={onRetry}>
                {t('Retry')}
              </button>
            </div>
          )}
          {!custom && installation.status === 'ready' && !isInstalled && (
            <p role="status">{t('Not installed')}</p>
          )}
          {!custom && installation.status === 'ready' && isInstalled && (
            <p role="status">
              {/* The version is data, so only the label sentence is translated. */}
              {t('Installed {version}', { version: installedVersion ?? '' })}
            </p>
          )}
          {busy && active && <p role="status">{t(PHASE_LABELS[active.phase])}</p>}
          {customBusy && customAction && (
            <p role="status">{t(CUSTOM_PHASE_LABELS[customAction.kind][customAction.phase])}</p>
          )}
          {!custom && notice && !busy && (
            <p className="agent-hub-dialog__notice" role="status">
              {t(notice.text, notice.values)}
            </p>
          )}
          {custom && customNotice && !customBusy && (
            <p className="agent-hub-dialog__notice" role="status">
              {t(customNotice.text, customNotice.values)}
            </p>
          )}
        </div>
        <ScrollThumb targetRef={bodyRef} />
      </div>
      {custom && (
        <footer className="agent-hub-dialog__footer">
          {customForm === 'none' && (
            <>
              <button
                type="button"
                className="agent-hub-dialog__install"
                disabled={customBusy}
                onClick={() => {
                  setCustomForm('upload')
                  setPublishMessage('')
                }}
              >
                {t('Upload')}
              </button>
              <button
                type="button"
                className="agent-hub-dialog__uninstall"
                disabled={customBusy}
                onClick={() => setCustomForm('delete')}
              >
                {t('Delete')}
              </button>
            </>
          )}
          {customForm === 'upload' && (
            <div className="agent-hub-dialog__custom-form">
              <label>
                <span>{t('Publish message')}</span>
                <input
                  type="text"
                  aria-label={t('Publish message')}
                  value={publishMessage}
                  maxLength={200}
                  disabled={customBusy}
                  onChange={(event) => setPublishMessage(event.target.value)}
                />
              </label>
              <p className="agent-hub-dialog__hint">{t('Required for the APC submission.')}</p>
              <p className="agent-hub-dialog__hint">{t('Upload requires Power format v2.')}</p>
              <div className="agent-hub-dialog__custom-actions">
                <button
                  type="button"
                  className="agent-hub-dialog__install"
                  disabled={!messageValid || customBusy}
                  onClick={submitUpload}
                >
                  {t('Upload to APC')}
                </button>
                <button
                  type="button"
                  className="agent-hub-dialog__uninstall"
                  disabled={customBusy}
                  onClick={() => {
                    setCustomForm('none')
                    setPublishMessage('')
                  }}
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}
          {customForm === 'delete' && (
            <div className="agent-hub-dialog__confirm" role="alertdialog" aria-label={t('Delete this resource?')}>
              <p>{t('Delete this resource?')}</p>
              <p className="agent-hub-dialog__hint">
                {t('Removes the local {type} "{name}" for {agent}. This cannot be undone.', {
                  type: series.type,
                  name: series.name,
                  agent,
                })}
              </p>
              <div className="agent-hub-dialog__custom-actions">
                <button
                  type="button"
                  className="agent-hub-dialog__uninstall"
                  disabled={customBusy}
                  onClick={confirmDelete}
                >
                  {t('Confirm delete')}
                </button>
                <button
                  type="button"
                  className="agent-hub-dialog__install"
                  disabled={customBusy}
                  onClick={() => setCustomForm('none')}
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}
        </footer>
      )}
      {!custom && (showInstall || showUninstall) && (
        <footer className="agent-hub-dialog__footer">
          {showInstall && (
            <button type="button" className="agent-hub-dialog__install" disabled={!writeEnabled} onClick={onInstall}>
              {t('Install')}
            </button>
          )}
          {showUninstall && !confirmingUninstall && (
            <button
              type="button"
              className="agent-hub-dialog__uninstall"
              disabled={!writeEnabled}
              onClick={() => setConfirmingUninstall(true)}
            >
              {t('Uninstall')}
            </button>
          )}
          {showUninstall && confirmingUninstall && (
            <div className="agent-hub-dialog__confirm" role="alertdialog" aria-label={t('Uninstall this Power?')}>
              <p>{t('Uninstall this Power?')}</p>
              <p className="agent-hub-dialog__hint">
                {t('Removes {type} "{name}" for {agent}.', {
                  type: series.type,
                  name: series.name,
                  agent,
                })}
              </p>
              <div className="agent-hub-dialog__custom-actions">
                <button
                  type="button"
                  className="agent-hub-dialog__uninstall"
                  disabled={!writeEnabled}
                  onClick={confirmUninstall}
                >
                  {t('Confirm uninstall')}
                </button>
                <button
                  type="button"
                  className="agent-hub-dialog__install"
                  disabled={busy}
                  onClick={() => setConfirmingUninstall(false)}
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}
        </footer>
      )}
    </dialog>
  )
}
