import type { FeatureServiceApiV1 } from '@bibit/feature-sdk'
import {
  SETTINGS_GET_OPERATION_ID,
  SETTINGS_KEY_ADD_OPERATION_ID,
  SETTINGS_KEY_DELETE_OPERATION_ID,
  SETTINGS_KEY_ENABLE_OPERATION_ID,
  parseSettingsKeyAdd,
  parseSettingsKeyTarget,
  parseSettingsView,
  type AgentHubSettingsV1,
} from './contracts'

/**
 * Client for the APC credential operations. Like the other service clients every
 * request is a validated closed DTO and every result is re-validated before the
 * page sees it, so a provider that answers with something else surfaces as a
 * local error instead of putting an unexpected value in the list.
 *
 * The real key only ever travels plugin → provider (`settings.keys.add.v1`). The
 * answers carry masked previews, so the page never reads a credential back out.
 */

export const SETTINGS_READ_TIMEOUT_MS = 30_000 as const
export const SETTINGS_WRITE_TIMEOUT_MS = 30_000 as const

const SERVICE_ID = 'store' as const

/** Reads the saved keys as masked rows. */
export async function readSettings(
  service: FeatureServiceApiV1<'store'>,
  signal: AbortSignal
): Promise<AgentHubSettingsV1> {
  const result = await service.request<Record<string, unknown>>({
    serviceId: SERVICE_ID,
    operationId: SETTINGS_GET_OPERATION_ID,
    params: {},
    timeoutMs: SETTINGS_READ_TIMEOUT_MS,
    signal,
  })
  return parseSettingsView(result, 'Invalid settings.get.v2 result:')
}

/**
 * Saves one key and returns the whole list. The provider enables it only when it
 * is the first saved key; the page reflects that from the answer rather than
 * guessing.
 */
export async function addSettingsKey(
  service: FeatureServiceApiV1<'store'>,
  apiKey: string,
  signal: AbortSignal
): Promise<AgentHubSettingsV1> {
  const input = parseSettingsKeyAdd({ apiKey })
  const result = await service.request<Record<string, unknown>>({
    serviceId: SERVICE_ID,
    operationId: SETTINGS_KEY_ADD_OPERATION_ID,
    params: input as unknown as Record<string, unknown>,
    timeoutMs: SETTINGS_WRITE_TIMEOUT_MS,
    signal,
  })
  return parseSettingsView(result, 'Invalid settings.keys.add.v1 result:')
}

/** Removes one saved key. No confirmation is asked here; the click is the intent. */
export async function deleteSettingsKey(
  service: FeatureServiceApiV1<'store'>,
  id: string,
  signal: AbortSignal
): Promise<AgentHubSettingsV1> {
  const input = parseSettingsKeyTarget({ id }, SETTINGS_KEY_DELETE_OPERATION_ID)
  const result = await service.request<Record<string, unknown>>({
    serviceId: SERVICE_ID,
    operationId: SETTINGS_KEY_DELETE_OPERATION_ID,
    params: input as unknown as Record<string, unknown>,
    timeoutMs: SETTINGS_WRITE_TIMEOUT_MS,
    signal,
  })
  return parseSettingsView(result, 'Invalid settings.keys.delete.v1 result:')
}

/** Makes one saved key the only enabled one, so it is what uploads use. */
export async function enableSettingsKey(
  service: FeatureServiceApiV1<'store'>,
  id: string,
  signal: AbortSignal
): Promise<AgentHubSettingsV1> {
  const input = parseSettingsKeyTarget({ id }, SETTINGS_KEY_ENABLE_OPERATION_ID)
  const result = await service.request<Record<string, unknown>>({
    serviceId: SERVICE_ID,
    operationId: SETTINGS_KEY_ENABLE_OPERATION_ID,
    params: input as unknown as Record<string, unknown>,
    timeoutMs: SETTINGS_WRITE_TIMEOUT_MS,
    signal,
  })
  return parseSettingsView(result, 'Invalid settings.keys.enable.v1 result:')
}
