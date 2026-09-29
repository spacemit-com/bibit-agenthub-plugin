import { webcrypto } from 'node:crypto'

/**
 * jsdom replaces `globalThis.crypto` with an implementation that has no
 * `subtle`, so `crypto.subtle.digest` is undefined on Node 18 (the version the
 * debian package allows: `nodejs (>= 18.12)`). The catalog-integrity tests and
 * every `powers.list.v1` market fixture need a real SHA-256, so the setup
 * installs Node's own WebCrypto when the environment's is incomplete.
 *
 * Node 20+ already exposes a complete `globalThis.crypto`, so this is a no-op
 * there; it only makes the suite run on the oldest supported Node.
 */
if (globalThis.crypto?.subtle === undefined) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}
