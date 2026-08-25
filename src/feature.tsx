import type { FeatureModuleV1 } from '@bibit/feature-sdk'
import { AgentHubPage } from './AgentHubPage'

export const featureModule: FeatureModuleV1 = { sdkApiVersion: 1, pages: { home: AgentHubPage } }
