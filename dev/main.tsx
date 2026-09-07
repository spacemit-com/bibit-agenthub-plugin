import React from 'react'
import { createRoot } from 'react-dom/client'
import { FeatureDevHost } from '@bibit/feature-dev-host'
import '@bibit/feature-dev-host/styles.css'
import type { FeatureManifestV1 } from '@bibit/feature-contracts'
import manifestJson from '../bibit.feature.json'
import { featureModule } from '../src/feature'

// The Dev Host's serviceConnections bridge forwards each store request to the
// Vite dev-store middleware, which runs the same raw powers.list.v1 wire contract
// as the production Go provider. `storeEndpoint` remains overridable for pointing
// Local Preview at an alternate transport.
const storeEndpoint =
  new URLSearchParams(globalThis.location.search).get('storeEndpoint') ??
  '/dev-services/store/invoke'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FeatureDevHost
      manifest={manifestJson as FeatureManifestV1}
      module={featureModule}
      serviceConnections={{ store: storeEndpoint }}
    />
  </React.StrictMode>
)