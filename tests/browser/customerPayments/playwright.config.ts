import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  outputDir: '/tmp/luster-customer-payments-browser-results',
  use: { baseURL: 'http://127.0.0.1:3199', trace: 'retain-on-failure' },
  webServer: {
    command: './node_modules/.bin/vite --config tests/browser/customerPayments/vite.config.ts',
    cwd: '../../..',
    url: 'http://127.0.0.1:3199',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
