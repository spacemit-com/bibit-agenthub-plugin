export type AgentSummary = {
  id: string
  name: string
  description: string
}

export type AgentHubSettings = {
  showExperimental: boolean
  refreshMinutes: number
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
