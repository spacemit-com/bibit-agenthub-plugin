import { useEffect, useRef, useState } from 'react'
import { useFeatureCapability } from '@bibit/feature-sdk'
import { useAgentHubI18n } from './agentHubI18n'
import {
  SETTINGS_GET_OPERATION_ID,
  SETTINGS_MAX_API_KEY_LENGTH,
  SETTINGS_MAX_REFRESH_MINUTES,
  SETTINGS_MIN_REFRESH_MINUTES,
  SETTINGS_UPDATE_OPERATION_ID,
  parseSettingsView,
  type AgentHubSettingsV1,
} from './api/contracts'
import './agentHub.css'

/**
 * The settings contribution is content-only: the host owns the "Settings"
 * heading, the sub-menu and the scrolling shell, so this renders a plain
 * `section` that shrinks to the content area (never a `main`).
 *
 * The APC API key is write-only from this side: the service answers with
 * `hasApiKey` and never with the value, so the page can only report whether one
 * is configured and can only replace or clear it.
 */
export function AgentHubSettingsPage() {
  const t = useAgentHubI18n()
  const store = useFeatureCapability('service:store')
  const [settings, setSettings] = useState<AgentHubSettingsV1 | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [status, setStatus] = useState('Loading settings…')
  const [saving, setSaving] = useState(false)
  // Only a user edit may change the stored key. Omitting `apiKey` keeps it;
  // sending an empty string clears it, so the two must stay distinguishable.
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    if (!store) {
      setStatus('Store capability is unavailable.')
      return () => controller.abort()
    }
    void store
      .request<Record<string, unknown>>({
        serviceId: 'store',
        operationId: SETTINGS_GET_OPERATION_ID,
        params: {},
        signal: controller.signal,
      })
      .then((value) => {
        if (controller.signal.aborted) return
        setSettings(parseSettingsView(value, 'Invalid settings.get.v1 result:'))
        setApiKeyInput('')
        setApiKeyDirty(false)
        setStatus('Settings synchronized.')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('Could not load Agent Hub settings.')
      })
    return () => controller.abort()
  }, [store])

  const save = async () => {
    if (!store || !settings || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setStatus('Saving…')
    try {
      const payload: Record<string, unknown> = {
        showExperimental: settings.showExperimental,
        refreshMinutes: settings.refreshMinutes,
      }
      if (apiKeyDirty) payload.apiKey = apiKeyInput
      const value = await store.request<Record<string, unknown>>({
        serviceId: 'store',
        operationId: SETTINGS_UPDATE_OPERATION_ID,
        params: payload,
      })
      setSettings(parseSettingsView(value, 'Invalid settings.update.v1 result:'))
      setApiKeyInput('')
      setApiKeyDirty(false)
      setStatus('Settings saved.')
    } catch {
      setStatus('Could not save Agent Hub settings.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const clearKey = () => {
    // Clearing goes through the same dirty path, so it only takes effect on the
    // next save: a stray click cannot silently drop the credential.
    setApiKeyInput('')
    setApiKeyDirty(true)
  }

  return (
    <section className="agent-hub-settings">
      <header>
        <p>{t('CATALOG PREFERENCES')}</p>
        <h1>{t('Agent Hub settings')}</h1>
      </header>
      <label>
        <span>
          <strong>{t('Experimental Agents')}</strong>
          <small>{t('Include preview Agents in the catalog.')}</small>
        </span>
        <input
          type="checkbox"
          checked={settings?.showExperimental ?? false}
          disabled={settings === null}
          onChange={(event) =>
            setSettings((current) => (current ? { ...current, showExperimental: event.target.checked } : current))
          }
        />
      </label>
      <label>
        <span>
          <strong>{t('Catalog refresh')}</strong>
          <small>{t('Refresh interval in minutes.')}</small>
        </span>
        <input
          type="number"
          min={SETTINGS_MIN_REFRESH_MINUTES}
          max={SETTINGS_MAX_REFRESH_MINUTES}
          value={settings?.refreshMinutes ?? SETTINGS_MIN_REFRESH_MINUTES}
          disabled={settings === null}
          onChange={(event) =>
            setSettings((current) =>
              current ? { ...current, refreshMinutes: Number(event.target.value) } : current
            )
          }
        />
      </label>
      <div className="agent-hub-settings__credential">
        <div className="agent-hub-settings__credential-head">
          <strong>{t('APC API Key')}</strong>
          <span data-testid="api-key-state">
            {settings === null ? t('Loading settings…') : settings.hasApiKey ? t('Configured') : t('Not configured')}
          </span>
        </div>
        <small>{t('Required to upload custom resources to APC.')}</small>
        <input
          type="password"
          aria-label={t('APC API Key')}
          autoComplete="off"
          value={apiKeyInput}
          maxLength={SETTINGS_MAX_API_KEY_LENGTH}
          disabled={settings === null}
          onChange={(event) => {
            setApiKeyInput(event.target.value)
            setApiKeyDirty(true)
          }}
        />
        <div className="agent-hub-settings__credential-actions">
          <small>{t('The API Key is never shown again once saved.')}</small>
          <button type="button" disabled={settings === null} onClick={clearKey}>
            {t('Clear saved key')}
          </button>
        </div>
      </div>
      <footer>
        <span role="status">{t(status)}</span>
        <button type="button" disabled={saving || settings === null} onClick={() => void save()}>
          {t('Save settings')}
        </button>
      </footer>
    </section>
  )
}
