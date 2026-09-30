import { useEffect, useRef, useState } from 'react'
import type { FeatureServiceApiV1 } from '@bibit/feature-sdk'
import { useAgentHubI18n } from '../agentHubI18n'
import { SETTINGS_MAX_API_KEY_LENGTH, type AgentHubSettingsKeyV1 } from '../api/contracts'
import {
  addSettingsKey,
  deleteSettingsKey,
  enableSettingsKey,
  readSettings,
} from '../api/settingsClient'

/**
 * The APC credential manager, rendered as the Agent Hub page's Settings tab.
 *
 * It is a page section, not a settings contribution: the page owns the heading
 * and the scrolling, so this renders a plain `section` and never a `main` or a
 * second scroll container.
 *
 * Credentials are write-only from this side. The provider answers with masked
 * previews (`head****tail`) plus an opaque id, so the panel can list, enable and
 * delete saved keys without ever holding one. Adding a key is its own action —
 * there is no form-wide save, and deleting is a single click, because the row's
 * own button already names the key being removed.
 *
 * Exactly one key may be enabled, and that key is the credential `apm submit`
 * receives. The provider decides the flag: the first saved key comes back
 * enabled because there is nothing else to fall back on, every later one arrives
 * disabled so adding a key never silently switches the active credential, and
 * deleting the active key leaves the rest disabled until the user picks one.
 */
export interface AgentHubSettingsPanelProps {
  /** The page's pinned store proxy, so a host re-render cannot restart the read. */
  service: FeatureServiceApiV1<'store'> | undefined
}

type Action = { kind: 'add' } | { kind: 'enable' | 'delete'; id: string }

export function AgentHubSettingsPanel({ service }: AgentHubSettingsPanelProps) {
  const t = useAgentHubI18n()
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [status, setStatus] = useState('Loading settings…')
  const [action, setAction] = useState<Action | null>(null)
  const actionRef = useRef<Action | null>(null)
  const writeControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    if (!service) {
      setStatus('Store capability is unavailable.')
      return () => controller.abort()
    }
    readSettings(service, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setSettings(value)
        setApiKeyInput('')
        setStatus('Settings synchronized.')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('Could not load Agent Hub settings.')
      })
    return () => controller.abort()
  }, [service])

  // A write that outlives the tab is still a write: the request is cancelled on
  // unmount so the page never updates state for a panel that is gone.
  useEffect(() => {
    return () => writeControllerRef.current?.abort()
  }, [])

  const run = async (next: Action, request: (signal: AbortSignal) => Promise<SettingsState>) => {
    if (!service || !settings || actionRef.current) return
    actionRef.current = next
    setAction(next)
    setStatus(next.kind === 'delete' ? 'Deleting…' : next.kind === 'enable' ? 'Enabling…' : 'Saving…')
    const controller = new AbortController()
    writeControllerRef.current = controller
    try {
      const value = await request(controller.signal)
      if (controller.signal.aborted) return
      setSettings(value)
      if (next.kind === 'add') setApiKeyInput('')
      setStatus(
        next.kind === 'delete'
          ? 'Key deleted.'
          : next.kind === 'enable'
            ? 'Key enabled.'
            : 'Key saved.'
      )
    } catch {
      if (!controller.signal.aborted) {
        setStatus(
          next.kind === 'delete'
            ? 'Could not delete the key.'
            : next.kind === 'enable'
              ? 'Could not enable the key.'
              : 'Could not save the key.'
        )
      }
    } finally {
      actionRef.current = null
      writeControllerRef.current = null
      if (!controller.signal.aborted) setAction(null)
    }
  }

  const trimmedInput = apiKeyInput.trim()
  const busy = action !== null
  const canAdd = settings !== null && trimmedInput !== '' && !busy

  return (
    <section className="agent-hub-settings-panel">
      <div className="agent-hub-settings-panel__credential">
        <div className="agent-hub-settings-panel__credential-head">
          <strong>{t('APC API Key')}</strong>
          <span data-testid="api-key-count">
            {settings === null
              ? t('Loading settings…')
              : settings.keys.length === 0
                ? t('No key saved')
                : t('{count} saved', { count: String(settings.keys.length) })}
          </span>
        </div>
        <small>{t('Required to upload custom resources to APC.')}</small>
        <div className="agent-hub-settings-panel__credential-add">
          <input
            type="password"
            aria-label={t('APC API Key')}
            autoComplete="off"
            value={apiKeyInput}
            maxLength={SETTINGS_MAX_API_KEY_LENGTH}
            disabled={settings === null}
            onChange={(event) => setApiKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canAdd) void saveKey()
            }}
          />
          <button type="button" disabled={!canAdd} onClick={() => void saveKey()}>
            {t('Save key')}
          </button>
        </div>
        <small>{t('The saved key is only shown masked.')}</small>
      </div>
      {settings !== null && service && settings.keys.length > 0 && (
        <ul className="agent-hub-settings-panel__keys" aria-label={t('Saved API Keys')}>
          {settings.keys.map((key) => (
            <KeyRow
              key={key.id}
              entry={key}
              busy={busy}
              activeAction={action}
              onEnable={() =>
                void run({ kind: 'enable', id: key.id }, (signal) => enableSettingsKey(service, key.id, signal))
              }
              onDelete={() =>
                void run({ kind: 'delete', id: key.id }, (signal) => deleteSettingsKey(service, key.id, signal))
              }
            />
          ))}
        </ul>
      )}
      <footer>
        <span role="status">{t(status)}</span>
      </footer>
    </section>
  )

  function saveKey() {
    if (!canAdd || !service) return
    const value = trimmedInput
    void run({ kind: 'add' }, (signal) => addSettingsKey(service, value, signal))
  }
}

type SettingsState = { showExperimental: boolean; refreshMinutes: number; keys: AgentHubSettingsKeyV1[] }

interface KeyRowProps {
  entry: AgentHubSettingsKeyV1
  busy: boolean
  activeAction: Action | null
  onEnable(): void
  onDelete(): void
}

function KeyRow({ entry, busy, activeAction, onEnable, onDelete }: KeyRowProps) {
  const t = useAgentHubI18n()
  const enabling = activeAction?.kind === 'enable' && activeAction.id === entry.id
  const deleting = activeAction?.kind === 'delete' && activeAction.id === entry.id
  return (
    <li className="agent-hub-settings-panel__key" data-enabled={entry.enabled ? 'true' : 'false'}>
      <span className="agent-hub-settings-panel__key-preview">{entry.preview}</span>
      <span className="agent-hub-settings-panel__key-state">
        {entry.enabled ? t('Enabled') : t('Not enabled')}
      </span>
      <span className="agent-hub-settings-panel__key-actions">
        <button
          type="button"
          disabled={entry.enabled || busy}
          onClick={onEnable}
          aria-label={t('Enable key {preview}', { preview: entry.preview })}
        >
          {enabling ? t('Enabling…') : t('Enable')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          aria-label={t('Delete key {preview}', { preview: entry.preview })}
        >
          {deleting ? t('Deleting…') : t('Delete')}
        </button>
      </span>
    </li>
  )
}
