import { useEffect, useRef, useState } from 'react'
import type { FeatureServiceApiV1 } from '@bibit/feature-sdk'
import { useAgentHubI18n } from '../agentHubI18n'
import {
  SETTINGS_GET_OPERATION_ID,
  SETTINGS_MAX_API_KEY_LENGTH,
  SETTINGS_UPDATE_OPERATION_ID,
  parseSettingsView,
  type AgentHubSettingsV1,
} from '../api/contracts'

/**
 * The APC credential form, rendered as the Agent Hub page's Settings tab.
 *
 * It is a page section, not a settings contribution: the page owns the heading
 * and the scrolling, so this renders a plain `section` and never a `main` or a
 * second scroll container.
 *
 * The APC API key is write-only from this side: the service answers with
 * `hasApiKey` and never with the value, so the panel can only report whether one
 * is configured and can only replace or clear it.
 *
 * `settings.update.v1` still carries `showExperimental` and `refreshMinutes`:
 * they are part of the operation's closed DTO but nothing consumes them, so the
 * panel reads them back unchanged instead of exposing controls that would do
 * nothing. The provider is untouched.
 */
export interface AgentHubSettingsPanelProps {
  /** The page's pinned store proxy, so a host re-render cannot restart the read. */
  service: FeatureServiceApiV1<'store'> | undefined
}

export function AgentHubSettingsPanel({ service }: AgentHubSettingsPanelProps) {
  const t = useAgentHubI18n()
  const [settings, setSettings] = useState<AgentHubSettingsV1 | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [status, setStatus] = useState('Loading settings…')
  const [saving, setSaving] = useState(false)
  // Only a user edit may change the stored key. Omitting `apiKey` keeps it;
  // sending an empty string clears it, so the two must stay distinguishable.
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const savingRef = useRef(false)
  const writeControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    if (!service) {
      setStatus('Store capability is unavailable.')
      return () => controller.abort()
    }
    void service
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
  }, [service])

  // A save that outlives the tab is still a save: the request is cancelled on
  // unmount so the page never updates state for a panel that is gone.
  useEffect(() => {
    return () => writeControllerRef.current?.abort()
  }, [])

  const save = async () => {
    if (!service || !settings || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setStatus('Saving…')
    const controller = new AbortController()
    writeControllerRef.current = controller
    try {
      const payload: Record<string, unknown> = {
        showExperimental: settings.showExperimental,
        refreshMinutes: settings.refreshMinutes,
      }
      if (apiKeyDirty) payload.apiKey = apiKeyInput
      const value = await service.request<Record<string, unknown>>({
        serviceId: 'store',
        operationId: SETTINGS_UPDATE_OPERATION_ID,
        params: payload,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setSettings(parseSettingsView(value, 'Invalid settings.update.v1 result:'))
      setApiKeyInput('')
      setApiKeyDirty(false)
      setStatus('Settings saved.')
    } catch {
      if (!controller.signal.aborted) setStatus('Could not save Agent Hub settings.')
    } finally {
      savingRef.current = false
      writeControllerRef.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  const clearKey = () => {
    // Clearing goes through the same dirty path, so it only takes effect on the
    // next save: a stray click cannot silently drop the credential.
    setApiKeyInput('')
    setApiKeyDirty(true)
  }

  return (
    <section className="agent-hub-settings-panel">
      <div className="agent-hub-settings-panel__credential">
        <div className="agent-hub-settings-panel__credential-head">
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
        <div className="agent-hub-settings-panel__credential-actions">
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
