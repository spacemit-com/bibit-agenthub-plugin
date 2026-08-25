import type { FeatureModuleV1 } from '@bibit/feature-sdk'
import { AgentHubPage } from './AgentHubPage'
import { AgentHubSettingsPage } from './AgentHubSettingsPage'

export const featureModule: FeatureModuleV1 = {
  sdkApiVersion: 1,
  pages: { home: AgentHubPage },
  settings: { settings: AgentHubSettingsPage },
}
