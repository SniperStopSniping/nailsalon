import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../../test-results/owner-entry',
  use: { baseURL: 'http://127.0.0.1:3144', trace: 'retain-on-failure' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config tests/browser/ownerEntry/vite.config.ts',
    cwd: path.resolve(__dirname, '../../..'),
    url: 'http://127.0.0.1:3144',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
});
