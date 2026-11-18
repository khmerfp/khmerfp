// configure the isolated wallet-link browser tests.
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1, retries: 0, timeout: 30000,
  reporter: 'list', outputDir: './test-results',
  use: { baseURL: 'http://127.0.0.1:5187', browserName: 'chromium', viewport: { width: 1280, height: 900 }, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: 'node server.js', url: 'http://127.0.0.1:5187', reuseExistingServer: false, timeout: 60000 },
})
