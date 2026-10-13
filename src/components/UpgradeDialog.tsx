import { useEffect, useRef, useState } from 'react'
import { useAgentHubI18n } from '../agentHubI18n'
import { ALL_AGENTS, UPGRADE_SCOPES, type UpgradeScope, type UpgradeSummary } from '../api/upgrade'

/** What the dialog is showing: the form, the run, or its result. */
export type UpgradePhase =
  | { status: 'confirm' }
  | { status: 'running'; step: 'updating' | 'reconciling' }
  | { status: 'done'; summary: UpgradeSummary; reason: string }
  | { status: 'error'; text: string }

export interface UpgradeDialogProps {
  open: boolean
  /** The Agent the page is currently filtered to; the dialog opens on it. */
  agent: string
  phase: UpgradePhase
  onConfirm(scope: UpgradeScope): void
  onClose(): void
}

/**
 * The confirmation for a bulk upgrade.
 *
 * It exists because apm's own confirmation cannot: apm asks on its stdin, and the
 * provider runs it with a pipe that is not a terminal, so apm fails closed
 * without `--yes`. The dialog is therefore the only place the user can see what
 * is about to change and agree to it — which is the same information apm's own
 * prompt would have shown, minus the per-entry list, because working that out
 * would mean re-implementing apm's planner here.
 *
 * While the run is in flight nothing can close the dialog, including Escape. The
 * upgrade is not cancellable (Provider Protocol v1 has no cancellation), so
 * letting the dialog disappear would suggest the run stopped.
 */
export function UpgradeDialog({ open, agent, phase, onConfirm, onClose }: UpgradeDialogProps) {
  const t = useAgentHubI18n()
  const dialogRef = useRef<HTMLDialogElement>(null)
  // The scope starts on the Agent the user is already looking at, which is what
  // "update these" usually means; `all` stays available for the whole machine.
  const [scope, setScope] = useState<UpgradeScope>(agent as UpgradeScope)

  useEffect(() => {
    if (!open) return
    setScope(UPGRADE_SCOPES.includes(agent as UpgradeScope) ? (agent as UpgradeScope) : ALL_AGENTS)
  }, [open, agent])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open && typeof dialog.showModal === 'function') {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const running = phase.status === 'running'

  return (
    <dialog
      ref={dialogRef}
      className="agent-hub-dialog agent-hub-upgrade"
      aria-label={t('Update all')}
      // Escape fires `cancel`, which would close the element: refuse it while the
      // run is in flight so the dialog cannot be dismissed mid-upgrade.
      onCancel={(event) => {
        if (running) event.preventDefault()
      }}
      onClose={() => {
        if (!running) onClose()
      }}
    >
      <div className="agent-hub-dialog__body">
        <header className="agent-hub-dialog__header">
          <div>
            <h2>{t('Update all')}</h2>
          </div>
          <button
            type="button"
            className="agent-hub-dialog__close"
            aria-label={t('Close')}
            disabled={running}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {phase.status === 'confirm' && (
          <>
            <div className="agent-hub-dialog__field">
              <span className="agent-hub-dialog__label">{t('Agent')}</span>
              <select
                aria-label={t('Choose which Agents to update')}
                value={scope}
                onChange={(event) => setScope(event.target.value as UpgradeScope)}
              >
                {UPGRADE_SCOPES.map((value) => (
                  <option key={value} value={value}>
                    {value === ALL_AGENTS ? t('All Agents') : value}
                  </option>
                ))}
              </select>
            </div>
            <p className="agent-hub-dialog__description">
              {t('Update every installed Power for {agent}?', {
                agent: scope === ALL_AGENTS ? t('All Agents') : scope,
              })}
            </p>
          </>
        )}

        {running && (
          <p className="agent-hub-upgrade__progress" role="status">
            <span className="agent-hub__spinner" aria-hidden="true" />
            {phase.step === 'updating'
              ? t('Updating…')
              : t('Confirming installation state…')}
          </p>
        )}

        {phase.status === 'done' && (
          <p className="agent-hub-dialog__notice" role="status">
            {phase.summary.failed > 0
              ? t('{count} Power(s) could not be updated.', { count: phase.summary.failed })
              : phase.summary.changed > 0
                ? t('Updated {count} Power(s).', { count: phase.summary.changed })
                : t('Nothing needed updating.')}
          </p>
        )}

        {phase.status === 'error' && (
          <p className="agent-hub-dialog__notice" role="alert">
            {phase.text}
          </p>
        )}

        {phase.status === 'done' && phase.reason !== '' && (
          <p className="agent-hub-dialog__hint">{phase.reason}</p>
        )}
      </div>

      {/* Only the confirmation has an action row. Once the run starts the header's
          dismiss control is the single way out, which keeps one accessible name per
          action -- and while it is running even that is disabled. */}
      {phase.status === 'confirm' && (
        <footer className="agent-hub-dialog__footer">
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="agent-hub-dialog__install"
            onClick={() => onConfirm(scope)}
          >
            {t('Update')}
          </button>
        </footer>
      )}
    </dialog>
  )
}
