import { useEffect, useState } from 'react'
import { useFeatureCapability, type FeaturePageProps } from '@bibit/feature-sdk'
import './agentHub.css'

type AgentSummary = { id: string; name: string; description: string }

export function AgentHubPage(_: FeaturePageProps) {
  const store = useFeatureCapability('external-service:store')
  const [agents, setAgents] = useState<readonly AgentSummary[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!store) {
      setError('Store capability is not available.')
      return
    }
    store.request<AgentSummary[]>({ serviceId: 'store', operationId: 'agents.list', params: {} })
      .then(setAgents)
      .catch((reason) => setError(String(reason)))
  }, [store])

  return (
    <main className="agent-hub">
      <header><div><p>INTERNAL CATALOG</p><h1>Agent Hub</h1></div><button type="button">Upload package</button></header>
      {error && <p role="alert" className="agent-hub__error">{error}</p>}
      <section className="agent-hub__grid" aria-label="Available Agents">
        {agents.map((agent) => <article key={agent.id}><span>AGENT</span><h2>{agent.name}</h2><p>{agent.description}</p><button type="button">Install</button></article>)}
      </section>
    </main>
  )
}
