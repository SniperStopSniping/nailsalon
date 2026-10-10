import os from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: path.join(os.tmpdir(), 'luster-owner-assistant-recovery-results'),
  use: { baseURL: 'http://127.0.0.1:3176', trace: 'retain-on-failure' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config tests/browser/ownerAssistant/vite.config.ts',
    cwd: path.resolve(__dirname, '../../..'),
    url: 'http://127.0.0.1:3176',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium-320', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 740 } } },
    { name: 'chromium-390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'webkit-390', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
