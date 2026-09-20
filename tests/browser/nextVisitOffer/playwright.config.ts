import os from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({ testDir: '.', testMatch: '*.spec.ts', workers: 1, reporter: 'list', outputDir: path.join(os.tmpdir(), 'luster-next-visit-browser'), use: { baseURL: 'http://127.0.0.1:3147' }, webServer: { command: 'node node_modules/vite/bin/vite.js --config tests/browser/nextVisitOffer/vite.config.ts', cwd: path.resolve(__dirname, '../../..'), url: 'http://127.0.0.1:3147', reuseExistingServer: false }, projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }, { name: 'mobile-webkit', use: { ...devices['iPhone 13'], viewport: { width: 320, height: 720 } } }] });
