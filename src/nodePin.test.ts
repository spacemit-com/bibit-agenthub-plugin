import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import packageJson from '../package.json'

/**
 * The plugin bundle is a gzipped tar, so its bytes depend on the zlib the Node
 * runtime ships: Node 18 carries zlib 1.3 and Node 24 carries 1.3.1, and the same
 * source produces two different `.bibit-plugin.tgz` files (and therefore two
 * different SHA-256 values) depending on which one ran the build.
 *
 * `.nvmrc` is the single source of truth. `debian/rules` reads it to pick the
 * interpreter, `scripts/check-node.mjs` fails a build that runs on anything else,
 * and `npm run build:plugin` calls that check first. This test keeps the version
 * declared in `package.json` `engines` from drifting away from the pin, which
 * would otherwise leave a warning that no longer matches what the build enforces.
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
