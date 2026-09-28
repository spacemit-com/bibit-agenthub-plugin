import { describe, expect, it } from 'vitest'
import manifest from '../bibit.feature.json'
import grants from '../debian/agenthub-feature-grants.json'

/**
 * The four-layer capability check the host performs is: Manifest declares,
 * a grant approves, the host registers an implementation, and the Feature has a
 * live instance. The plugin owns the first two, and a mismatch in either one
 * shows up in production as `getCapability(...) === undefined` — an entry that is
 * silently disabled with no error anywhere. `debian/rules` installs this exact
 * file to `/etc/bibit/feature-capability-grants.d/agenthub.json`, so this test
 * is the only place the two halves are compared before a release.
 */
describe('capability declarations and their grant', () => {
  const granted = grants.features[manifest.id as keyof typeof grants.features] ?? []

  it('grants every capability the Manifest requires', () => {
    const missing = manifest.requiredHostCapabilities.filter(
      (capability) => !granted.includes(capability)
    )
    expect(missing).toEqual([])
  })

  it('declares every capability the grant approves, so nothing is granted silently', () => {
    const undeclared = granted.filter(
      (capability) => !manifest.requiredHostCapabilities.includes(capability)
    )
    expect(undeclared).toEqual([])
  })

  it('keeps host:actions paired with the create-resource entry', () => {
    expect(manifest.requiredHostCapabilities).toContain('host:actions')
    expect(granted).toContain('host:actions')
  })

  it('keeps the store operation list the provider implements', () => {
    expect(grants.serviceOperations[manifest.id as keyof typeof grants.serviceOperations]).toEqual({
      store: [
        'powers.list.v1',
        'powers.inspect.v1',
        'powers.install.v1',
        'powers.uninstall.v1',
        'settings.get.v1',
        'settings.update.v1',
      ],
    })
  })
})
