import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FeatureDevHost } from '@bibit/feature-dev-host'
import '@bibit/feature-dev-host/styles.css'
// Must follow the Dev Host styles: bounds the preview canvas to the host's page area.
import './devHostViewport.css'
import type { FeatureManifestV1 } from '@bibit/feature-contracts'
import manifestJson from '../bibit.feature.json'
import { featureModule } from '../src/feature'

// The Dev Host's serviceConnections bridge forwards each store request to the
// Vite dev-store middleware, which runs the same raw wire contracts as the
// production Go provider: powers.list.v1, powers.inspect.v1, powers.install.v1,
// powers.uninstall.v1, powers.custom.list.v1, powers.upload.v1,
// powers.delete.v1 and settings.get.v1 / settings.update.v1, with the read 30 s
// / write 120 s deadlines. The custom operations scan the real home directory of
// the machine running Vite (`dev/custom.ts` mirrors the provider's rules), which
// is what makes hand-installed resources visible in Local Preview.
// Agent choices and validation share INSTALLED_AGENTS (including hermes-agent)
// with the page; Hermes skill/plugin/mcp requests reach APM with the same id.
// `storeEndpoint` remains overridable for pointing Local Preview at an alternate
// transport.
const storeEndpoint =
  new URLSearchParams(globalThis.location.search).get('storeEndpoint') ??
  '/dev-services/store/invoke'

// Same values the host passes in production: normalized `en` or `zh-CN`.
const initialLanguage =
  new URLSearchParams(globalThis.location.search).get('lang') === 'zh-CN'
    ? 'zh-CN'
    : 'en'

function DevApp() {
  const [language, setLanguage] = useState<'en' | 'zh-CN'>(initialLanguage)
  return (
    <>
      <label
        style={{
          position: 'fixed',
          zIndex: 20,
          right: 20,
          top: 14,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        UI language
        <select
          aria-label="UI language"
          value={language}
          onChange={(event) => setLanguage(event.target.value as 'en' | 'zh-CN')}
        >
          <option value="en">English</option>
          <option value="zh-CN">中文</option>
        </select>
      </label>
      <FeatureDevHost
        manifest={manifestJson as FeatureManifestV1}
        module={featureModule}
        language={language}
        serviceConnections={{ store: storeEndpoint }}
      />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DevApp />
  </React.StrictMode>
)