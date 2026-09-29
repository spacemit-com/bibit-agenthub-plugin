import { describe, expect, it } from 'vitest'
import manifest from '../bibit.feature.json'
import packageJson from '../package.json'
import { agentHubLocales } from './agentHubI18n'
import { featureModule } from './feature'
import { pluginLocales } from './plugin'

describe('featureModule', () => {
  it('exports the declared home renderer and no settings contribution', () => {
    expect(featureModule.sdkApiVersion).toBe(1)
    expect(featureModule.pages?.home).toBeTypeOf('function')
    // The APC credential moved into the page's own Settings tab, so the plugin
    // registers nothing in Bibit's Settings shell.
    expect(manifest.contributions.settings).toEqual([])
    expect(featureModule.settings).toBeUndefined()
  })

  it('ships the menu locale resources for every declared locale', () => {
    expect(featureModule.locales).toBe(agentHubLocales)
    expect(Object.keys(featureModule.locales ?? {}).sort()).toEqual(['en', 'zh-CN'])
  })

  it('keeps the plugin entry export the host reads for menus', () => {
    // The host registers this named export as the `agent-hub` i18n namespace.
    expect(pluginLocales).toBe(agentHubLocales)
  })

  it('satisfies the manifest invariants the host relies on', () => {
    expect(manifest.id).toBe('agent-hub')
    expect(manifest.sdkApiVersion).toBe(featureModule.sdkApiVersion)
    expect(manifest.version).toBe(packageJson.version)
    expect(manifest.contributions.pages.map(({ id }) => id)).toEqual(
      Object.keys(featureModule.pages ?? {})
    )
    expect(manifest.contributions.settings.map(({ id }) => id)).toEqual(
      Object.keys(featureModule.settings ?? {})
    )
  })

  it('declares the locales it actually ships, including the required en', () => {
    expect(manifest.contributions.locales).toContain('en')
    expect([...manifest.contributions.locales].sort()).toEqual(
      Object.keys(agentHubLocales).sort()
    )
  })

  it('resolves every manifest locale key inside the agent-hub namespace', () => {
    const keys = [manifest.display.titleKey, manifest.display.descriptionKey].filter(
      (key): key is string => typeof key === 'string'
    )
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      const [namespace, name] = key.split(':')
      expect(namespace).toBe('agent-hub')
      for (const locale of Object.values(agentHubLocales)) {
        expect((locale as Record<string, string>)[name]).toBeTruthy()
      }
    }
  })
})
