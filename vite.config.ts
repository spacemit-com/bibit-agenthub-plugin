import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  optimizeDeps: {
    esbuildOptions: { jsx: 'automatic' },
  },
})
