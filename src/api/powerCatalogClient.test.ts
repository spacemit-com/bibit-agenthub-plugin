import { describe, expect, it } from 'vitest'
import type {
  FeatureServiceApiV1,
  FeatureServiceErrorV1,
  FeatureServiceRequestV1,
} from '@bibit/feature-sdk'
import {
  parseListPowersResult,
  toListPowersParams,
  type ListPowersInput,
  type ReadyListPowersResult,
} from './contracts'
import { listPowers } from './powerCatalogClient'

function readyFixture(): ReadyListPowersResult {
  return {
    status: 'ready',
    snapshot: 'catalog-1',
    items: [
      {
        type: 'skill',
        name: 'demo',
        versions: [
          { version: 'v2.0.0', description: 'new', tags: ['quality'] },
          { version: 'v1.0.0', description: 'old', tags: [] },
        ],
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    facets: { agents: [], tags: ['quality'] },
    warnings: [],
  }
}

function makeService(respond: () => unknown): {
  service: FeatureServiceApiV1<'store'>
  calls: FeatureServiceRequestV1<'store'>[]
} {
  const calls: FeatureServiceRequestV1<'store'>[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(
      input: FeatureServiceRequestV1<'store'>
    ): Promise<TResult> {
      calls.push(input)
      return respond() as TResult
    },
  }
  return { service, calls }
}

const input: ListPowersInput = {
  scope: 'market',
  type: 'skill',
  tags: ['quality'],
  page: 1,
  pageSize: 20,
}

describe('listPowers', () => {
  it('projects the input to the exact store request and parses the result', async () => {
    const readyResult = readyFixture()
    const { service, calls } = makeService(() => readyResult)
    const signal = new AbortController().signal

    const result = await listPowers(service, input, signal)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      serviceId: 'store',
      operationId: 'powers.list.v1',
      params: toListPowersParams(input),
      timeoutMs: 30000,
      signal,
    })
    expect(result).toEqual(parseListPowersResult(readyResult))
    expect(result).not.toBe(readyResult)
  })

  it('rejects a response with an unknown field using the safe validation prefix', async () => {
    const { service } = makeService(() => ({ ...readyFixture(), extra: true }))
    const signal = new AbortController().signal

    await expect(listPowers(service, input, signal)).rejects.toThrow(
      /^Invalid powers\.list\.v1 result:/
    )
  })

  it('preserves a FeatureServiceError rejected by the service as-is', async () => {
    const error: FeatureServiceErrorV1 = {
      version: 1,
      code: 'unavailable',
      message: 'store is down',
      retryable: true,
      diagnosticId: 'diag-1',
    }
    const { service } = makeService(() => {
      throw error
    })
    const signal = new AbortController().signal

    const caught = await listPowers(service, input, signal).catch((reason: unknown) => reason)

    expect(caught).toBe(error)
  })
})
