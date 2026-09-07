import { describe, expect, it } from 'vitest'
import { verifyCatalogText } from './catalogIntegrity'

describe('verifyCatalogText', () => {
  it('resolves when the SHA-256 of the text matches the snapshot', async () => {
    const text = '{"skills":{"items":[]}}'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    const snapshot = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    await expect(verifyCatalogText(text, snapshot)).resolves.toBeUndefined()
  })

  it('rejects a mismatched snapshot as a retryable unavailable error', async () => {
    await expect(verifyCatalogText('{"skills":{"items":[]}}', 'deadbeef')).rejects.toMatchObject({
      version: 1,
      code: 'unavailable',
      retryable: true,
    })
  })

  it('hashes the exact bytes, not a re-serialized form', async () => {
    const text = '{"skills":{"items":[{"name":"démo","tags":["a b"]}]}}'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    const snapshot = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    await expect(verifyCatalogText(text, snapshot)).resolves.toBeUndefined()
    // A byte-for-byte different text must not match the same snapshot.
    await expect(verifyCatalogText(text.replace('démo', 'demo'), snapshot)).rejects.toMatchObject({
      code: 'unavailable',
    })
  })
})
