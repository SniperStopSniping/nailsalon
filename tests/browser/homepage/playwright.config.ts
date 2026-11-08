import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../../test-results/homepage',
  use: { baseURL: process.env.HOMEPAGE_TEST_URL ?? 'http://127.0.0.1:3191', trace: 'retain-on-failure' },
  webServer: process.env.HOMEPAGE_TEST_URL
    ? undefined
    : {
        command: 'node node_modules/vite/bin/vite.js --config tests/browser/homepage/vite.config.ts',
        cwd: path.resolve(__dirname, '../../..'),
        url: 'http://127.0.0.1:3191',
        reuseExistingServer: true,
      },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
});
