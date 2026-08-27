import type { FeatureExternalServiceApiV1 } from '@bibit/feature-sdk'
import {
  POWERS_LIST_OPERATION_ID,
  parseListPowersResult,
  toListPowersParams,
  type ListPowersInput,
  type ListPowersResult,
} from './contracts'

export async function listPowers(
  service: FeatureExternalServiceApiV1<'store'>,
  input: ListPowersInput,
  signal: AbortSignal
): Promise<ListPowersResult> {
  const value = await service.request({
    serviceId: 'store',
    operationId: POWERS_LIST_OPERATION_ID,
    params: toListPowersParams(input),
    timeoutMs: 30_000,
    signal,
  })
  return parseListPowersResult(value)
}
