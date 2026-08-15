import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // vitest bundles its own copy of vite; the plugin type differs slightly.
  plugins: [react() as unknown as never],
  test: {
    environment: 'node',
    environmentMatchGlobs: [['test/**/*.test.tsx', 'jsdom']],
    setupFiles: ['./test/setup.ts'],
  },
})
