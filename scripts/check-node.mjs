#!/usr/bin/env node
/**
 * Refuses to build the plugin bundle on a Node other than the pinned one.
 *
 * The bundle is a gzipped tar, so its bytes -- and the SHA-256 a release
 * records -- come from the zlib the Node runtime ships. The version is the hard
 * gate; the zlib flavour is reported and warned about, because pinning the
 * version alone does not determine the bytes:
 *
 *   upstream Node 22.22.1 (nodejs.org, hence nvm)  zlib 1.3.1-e00f703
 *   Bianbu/Debian Node 22.22.1                     zlib 1.3.1.zlib-ng
 *
 * Both self-report 22.22.1, and gzipping one and the same tar stream gave
 * 101289 bytes on the first and 102084 on the second. So a version-only check
 * passes on either and a SHA-256 recorded from one describes only that machine.
 * The release bundles are built on the CI image, which is the board runtime
 * (Node 22.22.1, zlib-ng); building anywhere else produces a different file even
 * when the version matches, which is what the warning below surfaces.
 *
 * `.nvmrc` is the single source of truth for the version: `nvm use`,
 * `debian/rules` and this script all read it, so bumping the pin in one place
 * keeps them together. Moving it invalidates every bundle hash already recorded
 * for a release; those hold only for the toolchain that produced them.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `process.versions.zlib` of the runtime the release bundles are built on,
 * measured on the Bianbu Node 22.22.1 that the CI image and the board run.
 * Reported as a warning rather than enforced, so a rebuild on a differently
 * linked Node of the same version says so instead of silently recording a hash
 * that only holds locally.
 */
const EXPECTED_ZLIB = '1.3.1.zlib-ng'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let pinned
try {
  pinned = readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim()
} catch {
  console.error('check-node: .nvmrc is missing; it pins the Node version used to build the bundle.')
  process.exit(1)
}

const actual = process.versions.node
const actualZlib = process.versions.zlib

if (actual !== pinned) {
  console.error(
    [
      `check-node: this build must run on Node ${pinned} (found ${actual}).`,
      `  zlib here: ${actualZlib}`,
      '',
      'The plugin bundle is a gzipped tar, so its bytes — and therefore the',
      'recorded SHA-256 — depend on the runtime that built it. Building on a',
      'different Node produces a different file from the same source.',
      '',
      'The release bundles are built on the CI image (the board runtime, Node',
      `${pinned}). Build there, or point NODE at the same interpreter:`,
      '  NODE=/path/to/node dpkg-buildpackage -us -uc -b',
      '',
      'If the pin itself must move, edit .nvmrc and rebuild every recorded artifact.',
    ].join('\n')
  )
  process.exit(1)
}

if (actualZlib !== EXPECTED_ZLIB) {
  console.warn(
    [
      `check-node: Node ${actual} matches .nvmrc, but its zlib is ${actualZlib},`,
      `  not ${EXPECTED_ZLIB} as on the CI image / board.`,
      '  The bundle will therefore differ from the released one: one version string',
      '  covers an upstream build (plain zlib) and the Bianbu build (zlib-ng), and',
      '  they compress the same tar to different bytes. Fine for a local smoke',
      '  build; do not record its SHA-256 as the release hash.',
    ].join('\n')
  )
} else {
  console.log(`check-node: Node ${actual} (zlib ${actualZlib}) matches the pinned toolchain`)
}
