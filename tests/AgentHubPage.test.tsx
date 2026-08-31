// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FeatureHostApiProvider,
  type FeatureHostApiV1,
  type FeatureHostCapabilityApiV1,
  type FeatureServiceJobsApiV1,
} from '@bibit/feature-sdk'
import type {
  FeatureHostCapability,
  ServiceJobEventBatchV1,
  ServiceJobSnapshotV1,
} from '@bibit/feature-contracts'
import { AgentHubPage } from '../src/AgentHubPage'

afterEach(cleanup)

const agent = { id: 'demo', name: 'Demo Agent', description: 'A demo Agent.' }
const running: ServiceJobSnapshotV1 = {
  version: 1,
  jobId: 'job-1',
  owner: { featureId: 'agent-hub' },
  serviceId: 'store',
  operationId: 'agents.upload.v1',
  idempotencyKey: 'key-1',
  status: 'running',
  lastSequence: 1,
}

const setup = (options: { available?: boolean; selection?: object | null } = {}) => {
  let listener: ((batch: ServiceJobEventBatchV1) => void) | undefined
  const store = {
    request: vi.fn().mockResolvedValue([agent]),
  }
  const files = {
    select: vi.fn().mockResolvedValue(
      options.selection === undefined
        ? {
            version: 1,
            grantId: 'grant-1',
            direction: 'upload',
            displayName: 'sample.demo-agent',
            expiresAt: new Date(0).toISOString(),
            byteLength: 128,
          }
        : options.selection
    ),
  }
  const jobs: FeatureServiceJobsApiV1 = {
    availability: vi.fn().mockResolvedValue({
      available: options.available ?? true,
      ...((options.available ?? true) ? {} : { reason: 'provider_v2_unavailable' as const }),
    }),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(running),
    events: vi.fn().mockResolvedValue({ snapshot: running, events: [], hasGap: false }),
    start: vi.fn().mockResolvedValue({ version: 1, job: running }),
    cancel: vi.fn().mockResolvedValue({
      ...running,
      status: 'cancelled',
      error: { version: 1, code: 'cancelled', message: 'Cancelled' },
    }),
    subscribe: vi.fn((_, next) => {
      listener = next
      return () => { listener = undefined }
    }),
  }
  const capabilities: Record<string, unknown> = {
    'service:store': store,
    'file:transfer': files,
    'job:manage': jobs,
  }
  const hostApi: FeatureHostApiV1 = {
    sdkApiVersion: 1,
    featureId: 'agent-hub',
    grantedCapabilities: ['service:store', 'file:transfer', 'job:manage'],
    getCapability: <K extends FeatureHostCapability>(capability: K) =>
      capabilities[capability] as FeatureHostCapabilityApiV1<K> | undefined,
  }
  render(
    <FeatureHostApiProvider value={hostApi}>
      <AgentHubPage
        featureId="agent-hub"
        contributionId="home"
        subpath=""
        search={{}}
        navigation={{ push() {}, replace() {}, back() {} }}
      />
    </FeatureHostApiProvider>
  )
  return { store, files, jobs, emit: (snapshot: ServiceJobSnapshotV1) => listener?.({ snapshot, events: [], hasGap: false }) }
}

describe('AgentHub transfer demo', () => {
  it('starts upload from the business button, reports progress, and refreshes the catalog', async () => {
    const user = userEvent.setup()
    const demo = setup()
    await user.click(await screen.findByRole('button', { name: 'Upload Agent' }))

    expect(demo.files.select).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'agents.upload.v1',
      direction: 'upload',
    }))
    expect(demo.jobs.start).toHaveBeenCalledTimes(1)
    demo.emit({
      ...running,
      status: 'succeeded',
      lastSequence: 2,
      result: {
        agentId: 'uploaded',
        displayName: 'sample.demo-agent',
        bytes: 128,
        sha256: 'a'.repeat(64),
      },
    })
    await waitFor(() => expect(demo.store.request).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/Upload completed/)).toBeInTheDocument()
  })

  it('does not create a download job when the native save dialog is cancelled', async () => {
    const user = userEvent.setup()
    const demo = setup({ selection: null })
    await user.click(await screen.findByRole('button', { name: 'Download Demo Agent' }))
    expect(demo.files.select).toHaveBeenCalled()
    expect(demo.jobs.start).not.toHaveBeenCalled()
  })

  it('sends one explicit cancellation and removes the cancel action at terminal state', async () => {
    const user = userEvent.setup()
    const demo = setup()
    await user.click(await screen.findByRole('button', { name: 'Upload Agent' }))
    const cancel = await screen.findByRole('button', { name: 'Cancel transfer' })
    await user.dblClick(cancel)
    expect(demo.jobs.cancel).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Cancel transfer' })).not.toBeInTheDocument()
    )
  })

  it('disables transfer without Provider v2 while keeping the catalog visible', async () => {
    setup({ available: false })
    expect(await screen.findByText(/does not support asynchronous transfer v2/)).toBeInTheDocument()
    expect(screen.getByText('Demo Agent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload Agent' })).toBeDisabled()
  })
})
