import type { FeatureModuleV1 } from '@bibit/feature-sdk'
import { AgentHubPage } from './AgentHubPage'
import { agentHubLocales, withAgentHubI18n } from './agentHubI18n'

// One contribution only: the page. Settings used to be a separate settings
// contribution, but its only real field was the APC credential, which now lives
// in the page's own Settings tab next to My Powers / Power market, so the plugin
// no longer registers anything in Bibit's Settings shell.
export const featureModule: FeatureModuleV1 = {
  sdkApiVersion: 1,
  locales: agentHubLocales,
  pages: { home: withAgentHubI18n(AgentHubPage) },
}
