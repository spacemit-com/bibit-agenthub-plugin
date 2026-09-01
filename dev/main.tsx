import React from 'react'
import { createRoot } from 'react-dom/client'
import { FeatureDevHost } from '@bibit/feature-dev-host'
import '@bibit/feature-dev-host/styles.css'
import type {
  FeatureHostApiV1,
  FeatureHostCapabilityApiV1,
  FeatureServiceJobsApiV1,
} from '@bibit/feature-sdk'
import type {
  FeatureHostCapability,
  FeatureManifestV1,
  ServiceJobEventBatchV1,
  ServiceJobSnapshotV1,
} from '@bibit/feature-contracts'
import manifestJson from '../bibit.feature.json'
import { featureModule } from '../src/feature'
import { handlePowerCatalogMock } from './powerCatalogMock'

let mockAgents = [
  { id: 'release-notes', name: 'Release Notes', description: 'Turns merged changes into concise internal release notes.' },
  { id: 'incident-helper', name: 'Incident Helper', description: 'Collects evidence and prepares an incident timeline.' },
]
let settings = { showExperimental: false, refreshMinutes: 15 }
let currentJob: ServiceJobSnapshotV1 | undefined
const listeners = new Set<(batch: ServiceJobEventBatchV1) => void>()

const notify = () => {
  if (!currentJob) return
  const batch = { snapshot: currentJob, events: [], hasGap: false }
  listeners.forEach((listener) => listener(batch))
}

const jobs: FeatureServiceJobsApiV1 = {
  availability: async () => ({ available: true }),
  list: async () => currentJob ? [currentJob] : [],
  get: async () => currentJob!,
  events: async () => ({ snapshot: currentJob!, events: [], hasGap: false }),
  subscribe: (_, listener) => {
    listeners.add(listener)
    if (currentJob) listener({ snapshot: currentJob, events: [], hasGap: false })
    return () => listeners.delete(listener)
  },
  start: async (input) => {
    const jobId = crypto.randomUUID()
    currentJob = {
      version: 1,
      jobId,
      owner: { featureId: 'agent-hub' },
      serviceId: input.serviceId,
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      status: 'running',
      lastSequence: 1,
    }
    notify()
    window.setTimeout(() => {
      if (!currentJob || currentJob.jobId !== jobId || currentJob.status === 'cancelled') return
      currentJob = {
        ...currentJob,
        lastSequence: 2,
        progress: { completedBytes: 64, totalBytes: 128 },
      }
      notify()
    }, 350)
    window.setTimeout(() => {
      if (!currentJob || currentJob.jobId !== jobId || currentJob.status === 'cancelled') return
      const sha256 = 'a'.repeat(64)
      const upload = input.operationId === 'agents.upload.v1'
      const agentId = upload ? jobId : String(input.input.agentId)
      if (upload) {
        mockAgents = [
          ...mockAgents,
          { id: agentId, name: String(input.input.displayName), description: 'Uploaded through the scripted CLI demo.' },
        ]
      }
      currentJob = {
        ...currentJob,
        status: 'succeeded',
        lastSequence: 3,
        progress: { completedBytes: 128, totalBytes: 128 },
        result: upload
          ? { agentId, displayName: String(input.input.displayName), bytes: 128, sha256 }
          : { agentId, bytes: 128, sha256 },
      }
      notify()
    }, 900)
    return { version: 1, job: currentJob }
  },
  cancel: async () => {
    currentJob = {
      ...currentJob!,
      status: 'cancelled',
      lastSequence: (currentJob?.lastSequence ?? 0) + 1,
      error: { version: 1, code: 'cancelled', message: 'The demo transfer was cancelled.' },
    }
    notify()
    return currentJob
  },
}

const capabilities: Record<string, unknown> = {
  'service:store': {
    request: async ({ operationId, params }: { operationId: string; params: Readonly<Record<string, unknown>> }) => {
      if (operationId === 'powers.list.v1') return handlePowerCatalogMock({ operationId, params })
      if (operationId === 'agents.list.v1') return mockAgents
      if (operationId === 'settings.get.v1') return settings
      if (operationId === 'settings.update.v1') {
        settings = params as typeof settings
        return settings
      }
      throw new Error(`Unknown operation: ${operationId}`)
    },
  },
  'file:transfer': {
    select: async ({ direction }: { direction: 'upload' | 'download' }) => ({
      version: 1,
      grantId: crypto.randomUUID(),
      direction,
      displayName: direction === 'upload' ? 'sample-agent.demo-agent' : 'download.demo-agent',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...(direction === 'upload' ? { byteLength: 128 } : {}),
    }),
  },
  'job:manage': jobs,
}

const hostApi: FeatureHostApiV1 = {
  sdkApiVersion: 1,
  featureId: 'agent-hub',
  grantedCapabilities: ['service:store', 'file:transfer', 'job:manage'],
  getCapability: <K extends FeatureHostCapability>(capability: K) =>
    capabilities[capability] as FeatureHostCapabilityApiV1<K> | undefined,
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FeatureDevHost
      manifest={manifestJson as FeatureManifestV1}
      module={featureModule}
      hostApi={hostApi}
    />
  </React.StrictMode>
)
