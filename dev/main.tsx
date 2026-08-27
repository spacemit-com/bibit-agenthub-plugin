import React from 'react'
import { createRoot } from 'react-dom/client'
import { FeatureDevHost } from '@bibit/feature-dev-host'
import '@bibit/feature-dev-host/styles.css'
import type { FeatureManifestV1 } from '@bibit/feature-contracts'
import manifestJson from '../bibit.feature.json'
import { featureModule } from '../src/feature'
import { handlePowerCatalogMock } from './powerCatalogMock'

let settings = { showExperimental: false, refreshMinutes: 15 }

const storeEndpoint =
  new URLSearchParams(globalThis.location.search).get('storeEndpoint') ?? undefined

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FeatureDevHost
      manifest={manifestJson as FeatureManifestV1}
      module={featureModule}
      serviceMocks={storeEndpoint ? undefined : {
        store: ({ operationId, params }) => {
          if (operationId === 'powers.list.v1') return handlePowerCatalogMock({ operationId, params })
          if (operationId === 'settings.get.v1') return settings
          if (operationId === 'settings.update.v1') {
            settings = params as typeof settings
            return settings
          }
          return Promise.reject(new Error(`Unknown operation: ${operationId}`))
        },
      }}
      serviceConnections={storeEndpoint ? { store: storeEndpoint } : undefined}
    />
  </React.StrictMode>
)
