import os from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: path.join(os.tmpdir(), 'luster-appointment-workflow-browser-results'),
  use: { baseURL: 'http://127.0.0.1:3146', trace: 'retain-on-failure' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config tests/browser/appointmentWorkflow/vite.config.ts',
    cwd: path.resolve(__dirname, '../../..'),
    url: 'http://127.0.0.1:3146',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'narrow-webkit', use: { ...devices['iPhone 13'], viewport: { width: 320, height: 720 } } },
    { name: 'narrow-chromium', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 720 } } },
  ],
});
