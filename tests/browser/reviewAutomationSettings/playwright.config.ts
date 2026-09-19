import os from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: path.join(os.tmpdir(), 'luster-review-automation-settings-browser-results'),
  use: { baseURL: 'http://127.0.0.1:3142', trace: 'retain-on-failure' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config tests/browser/reviewAutomationSettings/vite.config.ts',
    cwd: path.resolve(__dirname, '../../..'),
    url: 'http://127.0.0.1:3142',
    reuseExistingServer: false,
  },
  projects: [{ name: 'mobile-320', use: { ...devices['iPhone SE'] } }, { name: 'mobile-390', use: { ...devices['iPhone 13'] } }],
});
