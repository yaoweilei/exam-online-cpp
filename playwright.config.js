const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
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
    baseURL: 'http://127.0.0.1:8000',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 1100 }
  },
  webServer: {
    command: 'powershell -ExecutionPolicy Bypass -File ./tests/e2e/scripts/start-e2e-backend.ps1',
    url: 'http://127.0.0.1:8000/healthz',
    reuseExistingServer: true,
    timeout: 300000
  }
});
