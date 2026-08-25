import React from 'react'
import { createRoot } from 'react-dom/client'
import { FeatureDevHost } from '@bibit/feature-dev-host'
import '@bibit/feature-dev-host/styles.css'
import type { FeatureManifestV1 } from '@bibit/feature-contracts'
import manifestJson from '../bibit.feature.json'
import { featureModule } from '../src/feature'

const mockAgents = [
  { id: 'release-notes', name: 'Release Notes', description: 'Turns merged changes into concise internal release notes.' },
  { id: 'incident-helper', name: 'Incident Helper', description: 'Collects evidence and prepares an incident timeline.' }
]

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><FeatureDevHost manifest={manifestJson as FeatureManifestV1} module={featureModule} serviceMocks={{ store: ({ operationId }) => operationId === 'agents.list' ? mockAgents : Promise.reject(new Error(`Unknown operation: ${operationId}`)) }} /></React.StrictMode>
)
