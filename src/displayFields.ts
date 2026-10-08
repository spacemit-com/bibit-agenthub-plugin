import type { AgentHubLanguage } from './agentHubI18n'
import type { PowerSeries, PowerType, PowerVersion } from './api/contracts'

/**
 * Resolves the user-facing Power title from the resource-format-v2 display names,
 * falling back to the canonical call name for V1 resources and for authors who
 * left a display name empty.
 *
 * A Chinese host prefers `name_zh`, then `name_en`, then `name`: an English
 * display name is still far more readable than a lowercase kebab call name. An
 * English host never shows Chinese, so it uses `name_en` and then `name`.
 */
export function resolvePowerTitle(series: PowerSeries, language: AgentHubLanguage): string {
  const display =
    language === 'zh'
      ? firstNonBlank(series.name_zh, series.name_en)
      : firstNonBlank(series.name_en)
  return display ?? series.name
}

/**
 * Resolves the description for the selected version. Only the Chinese field is
 * localized: `description` is the agent-facing source text that every resource
 * carries, so it is the correct English rendering and the universal fallback.
 */
export function resolvePowerDescription(
  version: PowerVersion,
  language: AgentHubLanguage
): string {
  const display =
    language === 'zh' ? firstNonBlank(version.description_zh) : undefined
  return display ?? version.description
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) return value
  }
  return undefined
}
