export type AgentSummary = {
  id: string
  name: string
  description: string
}

export type AgentHubSettings = {
  showExperimental: boolean
  refreshMinutes: number
}

export type AgentUploadResult = {
  agentId: string
  displayName: string
  bytes: number
  sha256: string
}

export type AgentDownloadResult = {
  agentId: string
  bytes: number
  sha256: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseAgentSummaries(value: unknown): readonly AgentSummary[] {
  if (!Array.isArray(value) || value.some((item) =>
    !isRecord(item) ||
    typeof item.id !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.description !== 'string'
  )) {
    throw new Error('Store returned an incompatible Agent list.')
  }
  return value as AgentSummary[]
}

export function parseAgentHubSettings(value: unknown): AgentHubSettings {
  if (
    !isRecord(value) ||
    typeof value.showExperimental !== 'boolean' ||
    !Number.isInteger(value.refreshMinutes) ||
    (value.refreshMinutes as number) < 5 ||
    (value.refreshMinutes as number) > 120
  ) {
    throw new Error('Store returned incompatible Agent Hub settings.')
  }
  return value as AgentHubSettings
}

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)

export function parseAgentUploadResult(value: unknown): AgentUploadResult {
  if (
    !isRecord(value) ||
    typeof value.agentId !== 'string' ||
    typeof value.displayName !== 'string' ||
    !Number.isSafeInteger(value.bytes) ||
    (value.bytes as number) < 0 ||
    !isSha256(value.sha256)
  ) {
    throw new Error('Store returned an incompatible upload result.')
  }
  return value as AgentUploadResult
}

export function parseAgentDownloadResult(value: unknown): AgentDownloadResult {
  if (
    !isRecord(value) ||
    typeof value.agentId !== 'string' ||
    !Number.isSafeInteger(value.bytes) ||
    (value.bytes as number) < 0 ||
    !isSha256(value.sha256)
  ) {
    throw new Error('Store returned an incompatible download result.')
  }
  return value as AgentDownloadResult
}
