const { defineConfig } = require('@playwright/test');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8000';
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === '1';

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  workers: 1,
  expect: {
    timeout: 15000
  },
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }]
  ],
  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'msedge',
    serviceWorkers: 'block',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 1100 }
  },
  webServer: {
    command: 'powershell -ExecutionPolicy Bypass -File ./tests/e2e/scripts/start-e2e-backend.ps1',
    url: `${baseURL.replace(/\/$/, '')}/healthz`,
    // Default to a freshly seeded, isolated backend. Opt in only for manual
    // debugging against an already running server.
    reuseExistingServer,
    timeout: 300000
  }
});
