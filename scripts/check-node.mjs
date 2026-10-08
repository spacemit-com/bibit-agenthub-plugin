#!/usr/bin/env node
/**
 * Refuses to build the plugin bundle with a Node other than the pinned one.
 *
 * The bundle is a gzipped tar, and the gzip step uses the zlib the Node runtime
 * ships. Node 18 carries zlib 1.3 and Node 24 carries zlib 1.3.1; compressing
 * one tar stream with each produces two different byte sequences of the same
 * archive. Every knob we tried (levels 0-9 across all five strategies) still
 * differs across the two runtimes, so the toolchain is the only thing that can
 * be pinned. Without this check the same source builds two different
 * `.bibit-plugin.tgz` files, and the SHA-256 recorded for a release silently
 * describes only the machine that ran the build.
 *
 * `.nvmrc` is the single source of truth: `nvm use`, `debian/rules` and this
 * script all read it, so bumping the pin in one place keeps them together.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let pinned
try {
  pinned = readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim()
} catch {
  console.error('check-node: .nvmrc is missing; it pins the Node version used to build the bundle.')
  process.exit(1)
}

const actual = process.versions.node
if (actual !== pinned) {
  console.error(
    [
      `check-node: this build must run on Node ${pinned} (found ${actual}).`,
      `  zlib here: ${process.versions.zlib}`,
      '',
      'The plugin bundle is a gzipped tar, so its bytes — and therefore its',
      'recorded SHA-256 — depend on the zlib the runtime ships. Building on a',
      'different Node produces a different file from the same source.',
      '',
      'Fix with one of:',
      `  nvm install && nvm use      # reads .nvmrc (${pinned})`,
      `  PATH="\${NVM_DIR:-$HOME/.nvm}/versions/node/v${pinned}/bin:$PATH" make ...`,
      '',
      'If the pin itself must move, edit .nvmrc and rebuild every recorded artifact.',
    ].join('\n')
  )
  process.exit(1)
}

console.log(`check-node: Node ${actual} (zlib ${process.versions.zlib}) matches .nvmrc`)
