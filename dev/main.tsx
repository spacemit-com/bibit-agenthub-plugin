import React from 'react'
import { createRoot } from 'react-dom/client'
import { FeatureDevHost } from '@bibit/feature-dev-host'
import '@bibit/feature-dev-host/styles.css'
import type { FeatureManifestV1 } from '@bibit/feature-contracts'
import manifestJson from '../bibit.feature.json'
import { featureModule } from '../src/feature'

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