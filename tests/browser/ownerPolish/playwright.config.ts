import os from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: path.join(os.tmpdir(), 'luster-owner-polish-browser-results'),
  use: { baseURL: 'http://127.0.0.1:3150', trace: 'retain-on-failure', contextOptions: { reducedMotion: 'reduce' } },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config tests/browser/ownerPolish/vite.config.ts',
    cwd: path.resolve(__dirname, '../../..'),
    url: 'http://127.0.0.1:3150',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'small-mobile-webkit', use: { ...devices['iPhone 13'], viewport: { width: 320, height: 720 } } },
  ],
});
