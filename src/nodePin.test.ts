import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import packageJson from '../package.json'

/**
 * The plugin bundle is a gzipped tar, so its bytes depend on the zlib the Node
 * runtime ships. That is both a version and a flavour question: one version
 * string covers an upstream build (plain zlib) and the Bianbu/Debian build
 * (zlib-ng), and they gzip the same tar to different bytes. `.nvmrc` pins the
 * version and `scripts/check-node.mjs` checks it together with the zlib string,
 * so a build that would produce a second, silently different bundle fails
 * instead of shipping.
 *
 * `.nvmrc` is the single source of truth for the version half. `debian/rules`
 * reads it to pick the interpreter, `npm run build:plugin` calls the check
 * first, and this test keeps `package.json` `engines` from drifting away from
 * the pin -- which would otherwise leave a warning that no longer matches what
 * the build enforces.
 */
describe('pinned Node version', () => {
  const pinned = readFileSync('.nvmrc', 'utf8').trim()

  it('pins an exact version, not a range', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('declares the same version in package.json engines', () => {
    expect(packageJson.engines?.node).toBe(pinned)
  })

  it('runs the build:plugin script through the pin check', () => {
    expect(packageJson.scripts['build:plugin']).toContain('check:node')
  })
})
