import { useEffect, useState } from 'react'
import { useFeatureCapability, type FeatureSettingsProps } from '@bibit/feature-sdk'
import { useAgentHubI18n } from './agentHubI18n'
import './agentHub.css'

type AgentHubSettings = {
  showExperimental: boolean
  refreshMinutes: number
}

const defaults: AgentHubSettings = { showExperimental: false, refreshMinutes: 15 }

export function AgentHubSettingsPage(_: FeatureSettingsProps) {
  const t = useAgentHubI18n()
  const store = useFeatureCapability('service:store')
  const [settings, setSettings] = useState(defaults)
  const [status, setStatus] = useState('Loading settings…')

  useEffect(() => {
    const controller = new AbortController()
    if (!store) {
      setStatus('Store capability is unavailable.')
      return () => controller.abort()
    }
    void store.request<AgentHubSettings>({
      serviceId: 'store',
      operationId: 'settings.get.v1',
      params: {},
      signal: controller.signal,
    }).then((value) => {
      setSettings(value)
      setStatus('Settings synchronized.')
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('Could not load Agent Hub settings.')
    })
    return () => controller.abort()
  }, [store])

  const save = async () => {
    if (!store) return
    setStatus('Saving…')
    try {
      await store.request({
        serviceId: 'store',
        operationId: 'settings.update.v1',
        params: settings,
      })
      setStatus('Settings saved.')
    } catch {
      setStatus('Could not save Agent Hub settings.')
    }
  }

  return (
    <main className="agent-hub-settings">
      <header><p>{t('CATALOG PREFERENCES')}</p><h1>{t('Agent Hub settings')}</h1></header>
      <label>
        <span><strong>{t('Experimental Agents')}</strong><small>{t('Include preview Agents in the catalog.')}</small></span>
        <input type="checkbox" checked={settings.showExperimental} onChange={(event) => setSettings({ ...settings, showExperimental: event.target.checked })} />
      </label>
      <label>
        <span><strong>{t('Catalog refresh')}</strong><small>{t('Refresh interval in minutes.')}</small></span>
        <input type="number" min="5" max="120" value={settings.refreshMinutes} onChange={(event) => setSettings({ ...settings, refreshMinutes: Number(event.target.value) })} />
      </label>
      <footer>
        <span role="status">{t(status)}</span>
        <button type="button" onClick={() => void save()}>{t('Save settings')}</button>
      </footer>
    </main>
  )
}
