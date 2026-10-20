import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  expect: { timeout: 8_000 },
  timeout: 30_000,
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  outputDir: path.join('/tmp', 'luster-renderer-https-browser-results'),
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'phone-chromium', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'phone-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
