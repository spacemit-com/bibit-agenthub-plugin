import { useEffect, useState } from 'react'
import { useFeatureCapability, type FeaturePageProps } from '@bibit/feature-sdk'
import './agentHub.css'
import { parseAgentSummaries, type AgentSummary } from './storeContracts'

export function AgentHubPage(_: FeaturePageProps) {
  const store = useFeatureCapability('service:store')
  const [agents, setAgents] = useState<readonly AgentSummary[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError('')
    if (!store) {
      setError('Store capability is not available.')
      setLoading(false)
      return () => { active = false }
    }
    void store.request<unknown>({
      serviceId: 'store',
      operationId: 'agents.list.v1',
      params: {},
      signal: controller.signal,
    }).then(parseAgentSummaries).then((items) => {
      if (active) setAgents(items)
    }).catch((reason) => {
      if (active) setError(String(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [store, reload])

  return (
    <main className="agent-hub">
      <header><div><p>INTERNAL CATALOG</p><h1>Agent Hub</h1></div></header>
      {loading && <p role="status" className="agent-hub__status">Loading Agents…</p>}
      {error && <div role="alert" className="agent-hub__error"><span>{error}</span><button type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
      {!loading && !error && agents.length === 0 && <p className="agent-hub__status">No Agents are available.</p>}
      <section className="agent-hub__grid" aria-label="Available Agents">
        {agents.map((agent) => <article key={agent.id}><span>AGENT</span><h2>{agent.name}</h2><p>{agent.description}</p></article>)}
      </section>
    </main>
  )
}
