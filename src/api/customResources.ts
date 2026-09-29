import type { FeatureServiceApiV1 } from '@bibit/feature-sdk'
import {
  POWERS_CUSTOM_LIST_OPERATION_ID,
  POWERS_DELETE_OPERATION_ID,
  POWERS_UPLOAD_OPERATION_ID,
  parseCustomListInput,
  parseCustomListResult,
  parseCustomResourceList,
  parseDeleteResult,
  parseDeleteTarget,
  parseUploadInput,
  parseUploadResult,
  type CustomResourceList,
  type DeleteResult,
  type PowerType,
  type UploadResult,
} from './contracts'

/**
 * Client for the custom-resource operations. Like `powerCatalogClient`, every
 * request is a validated closed DTO and every result is re-validated before the
 * page sees it; a provider that answers with something else maps to the
 * `incompatible` platform error instead of corrupting page state.
 */

export const CUSTOM_READ_TIMEOUT_MS = 30_000 as const
export const CUSTOM_WRITE_TIMEOUT_MS = 120_000 as const

export type CustomResourceTarget = { agent: string; type: PowerType; name: string }

const SERVICE_ID = 'store' as const

function platformError(code: 'cancelled' | 'incompatible', message: string, retryable: boolean): never {
  throw { version: 1, code, message, retryable }
}

/**
 * Reads the hand-installed resources of one Agent over `powers.custom.list.v1`
 * and parses the scanner document. An unparsable document is an incompatible
 * provider, not an empty list: silently showing "no custom resources" would
 * hide a real failure.
 */
export async function listCustomResources(
  service: FeatureServiceApiV1<'store'>,
  agent: string,
  signal: AbortSignal
): Promise<CustomResourceList> {
  const input = parseCustomListInput({ agent })
  const result = parseCustomListResult(
    await service.request<Record<string, unknown>>({
      serviceId: SERVICE_ID,
      operationId: POWERS_CUSTOM_LIST_OPERATION_ID,
      params: input as unknown as Record<string, unknown>,
      timeoutMs: CUSTOM_READ_TIMEOUT_MS,
      signal,
    })
  )
  if (signal.aborted) {
    platformError('cancelled', 'Request was cancelled.', false)
  }
  let document: unknown
  try {
    document = JSON.parse(result.itemsJson)
  } catch {
    platformError('incompatible', 'Provider returned an unparsable custom resource list.', false)
  }
  return parseCustomResourceList(document)
}

/**
 * Publishes one custom resource through apm. A non-zero exit is a result, not a
 * thrown error: the page needs the validate/submit verdict to tell the user what
 * to fix, and a platform failure (no key, provider down) stays an error.
 */
export async function uploadCustomResource(
  service: FeatureServiceApiV1<'store'>,
  input: { agent: string; type: PowerType; name: string; message: string },
  signal: AbortSignal
): Promise<UploadResult> {
  const parsed = parseUploadInput(input)
  const result = parseUploadResult(
    await service.request<Record<string, unknown>>({
      serviceId: SERVICE_ID,
      operationId: POWERS_UPLOAD_OPERATION_ID,
      params: parsed as unknown as Record<string, unknown>,
      timeoutMs: CUSTOM_WRITE_TIMEOUT_MS,
      signal,
    })
  )
  if (signal.aborted) {
    platformError('cancelled', 'Request was cancelled.', false)
  }
  return result
}

/** Removes the local directory of one custom resource (system rm semantics). */
export async function deleteCustomResource(
  service: FeatureServiceApiV1<'store'>,
  target: CustomResourceTarget,
  signal: AbortSignal
): Promise<DeleteResult> {
  const parsed = parseDeleteTarget(target)
  const result = parseDeleteResult(
    await service.request<Record<string, unknown>>({
      serviceId: SERVICE_ID,
      operationId: POWERS_DELETE_OPERATION_ID,
      params: parsed as unknown as Record<string, unknown>,
      timeoutMs: CUSTOM_WRITE_TIMEOUT_MS,
      signal,
    })
  )
  if (signal.aborted) {
    platformError('cancelled', 'Request was cancelled.', false)
  }
  return result
}

/**
 * The APC submission id apm printed, if any. `apm submit` reports through stdout
 * in a `key: value` form; parsing is deliberately tolerant because the exact
 * report text is apm's contract, not this plugin's.
 */
export function submissionIdFrom(stdout: string | undefined): string | undefined {
  if (!stdout) return undefined
  const match = /submission_id:\s*(\S+)/.exec(stdout)
  return match ? match[1] : undefined
}
