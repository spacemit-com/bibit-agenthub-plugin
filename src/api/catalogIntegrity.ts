/**
 * SHA-256 integrity check for the raw APC catalog text. The wire carries the
 * catalog as original UTF-8 JSON and the provider reports an opaque
 * `catalog_sha256` snapshot; before parsing or replacing the cache the client
 * recomputes the hash over the exact bytes and requires it to match.
 */
export async function verifyCatalogText(text: string, snapshot: string): Promise<void> {
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  if (actual !== snapshot) {
    throw {
      version: 1,
      code: 'unavailable',
      retryable: true,
      message: 'Catalog changed during refresh.',
    } as const
  }
}
