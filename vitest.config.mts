import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') }

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      { extends: true, test: { name: 'db', include: ['tests/db/**/*.test.ts'], environment: 'node', testTimeout: 20000 } },
      {
        extends: true,
        plugins: [react()],
        test: { name: 'ui', include: ['tests/ui/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['tests/ui/setup.ts'] }
      }
    ],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/main/services/**/*.ts', 'src/main/db/**/*.ts'],
      exclude: ['src/main/db/schema.ts', '**/*.d.ts']
    }
  }
})
