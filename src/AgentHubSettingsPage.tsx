import { useEffect, useRef, useState } from 'react'
import { useFeatureCapability, type FeatureSettingsProps } from '@bibit/feature-sdk'
import './agentHub.css'
import { parseAgentHubSettings, type AgentHubSettings } from './storeContracts'

const defaults: AgentHubSettings = { showExperimental: false, refreshMinutes: 15 }

export function AgentHubSettingsPage(_: FeatureSettingsProps) {
  const store = useFeatureCapability('external-service:store')
  const [settings, setSettings] = useState(defaults)
  const [status, setStatus] = useState('Loading settings…')
  const [saving, setSaving] = useState(false)
  const saveController = useRef<AbortController | null>(null)

  useEffect(() => () => saveController.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    if (!store) {
      setStatus('Store capability is unavailable.')
      return () => controller.abort()
    }
    void store.request<unknown>({
      serviceId: 'store',
      operationId: 'settings.get.v1',
      params: {},
      signal: controller.signal,
    }).then(parseAgentHubSettings).then((value) => {
      if (controller.signal.aborted) return
      setSettings(value)
      setStatus('Settings synchronized.')
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('Could not load Agent Hub settings.')
    })
    return () => controller.abort()
  }, [store])

  const save = async () => {
    if (!store || saveController.current) return
    const controller = new AbortController()
    saveController.current = controller
    setSaving(true)
    setStatus('Saving…')
    try {
      const value = await store.request<unknown>({
        serviceId: 'store',
        operationId: 'settings.update.v1',
        params: settings,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setSettings(parseAgentHubSettings(value))
      setStatus('Settings saved.')
    } catch {
      if (!controller.signal.aborted) setStatus('Could not save Agent Hub settings.')
    } finally {
      if (!controller.signal.aborted) setSaving(false)
      if (saveController.current === controller) saveController.current = null
    }
  }

  return (
    <section className="agent-hub-settings">
      <header><p>CATALOG PREFERENCES</p><h1>Agent Hub settings</h1></header>
      <label>
        <span><strong>Experimental Agents</strong><small>Include preview Agents in the catalog.</small></span>
        <input type="checkbox" checked={settings.showExperimental} onChange={(event) => setSettings({ ...settings, showExperimental: event.target.checked })} />
      </label>
      <label>
        <span><strong>Catalog refresh</strong><small>Refresh interval in minutes.</small></span>
        <input type="number" min="5" max="120" value={settings.refreshMinutes} onChange={(event) => setSettings({ ...settings, refreshMinutes: Number(event.target.value) })} />
      </label>
      <footer><span role="status">{status}</span><button type="button" disabled={!store || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save settings'}</button></footer>
    </section>
  )
}
