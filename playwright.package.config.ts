import { defineConfig } from '@playwright/test'

/** Drives the real installer. Run with npm run test:package, which builds it first. */
export default defineConfig({
  testDir: './tests/package',
  timeout: 600_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/package'
})
