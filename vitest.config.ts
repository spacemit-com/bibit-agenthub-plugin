import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'dev/**/*.test.ts'],
    // jsdom drops `crypto.subtle`; the setup restores Node's WebCrypto so the
    // catalog-integrity hashes work on the oldest supported Node too.
    setupFiles: ['src/testSetup.ts'],
  },
})
