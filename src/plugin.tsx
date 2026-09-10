import { registerFeaturePlugin } from '@bibit/feature-plugin-sdk'
import type { FeatureManifestV1 } from '@bibit/feature-contracts'
import manifestJson from '../bibit.feature.json'
import { featureModule } from './feature'

// The host reads this named export out of the installed bundle to register the
// `agent-hub` locale namespace that menu, navigation and description keys use.
export { agentHubLocales as pluginLocales } from './agentHubI18n'

registerFeaturePlugin({ manifest: manifestJson as FeatureManifestV1, module: featureModule })
