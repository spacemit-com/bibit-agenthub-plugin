import type { FeatureModuleV1 } from '@bibit/feature-sdk'
import { AgentHubPage } from './AgentHubPage'
import { AgentHubSettingsPage } from './AgentHubSettingsPage'
import { agentHubLocales, withAgentHubI18n } from './agentHubI18n'

export const featureModule: FeatureModuleV1 = {
  sdkApiVersion: 1,
  locales: agentHubLocales,
  pages: { home: withAgentHubI18n(AgentHubPage) },
  settings: { settings: withAgentHubI18n(AgentHubSettingsPage) },
}
