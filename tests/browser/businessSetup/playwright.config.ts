import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  expect: { timeout: 20_000 },
  timeout: 90_000,
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  outputDir: path.join('/tmp', 'luster-business-setup-browser-results'),
  use: { baseURL: 'http://localhost:3197', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
