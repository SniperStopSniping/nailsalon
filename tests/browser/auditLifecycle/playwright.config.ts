import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { requireDisposableDatabaseTarget } from '../../../src/libs/disposableDatabaseTarget';
import { e2eBaseUrl } from '../../e2e/support/config';

// This suite reads back stored appointments. Never run it against a hosted DB.
requireDisposableDatabaseTarget(process.env);

export default defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  outputDir: '../../../tmp/audit-lifecycle-results',
  reporter: [['list'], ['json', { outputFile: path.resolve(__dirname, '../../../tmp/audit-lifecycle-results.json') }]],
  use: { baseURL: e2eBaseUrl, timezoneId: 'America/Toronto', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'setup', testDir: path.resolve(__dirname, '../../e2e'), testMatch: 'auth.setup.ts' },
    { name: 'audit-chromium', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'audit-webkit', dependencies: ['setup'], use: { ...devices['iPhone 13'] } },
    { name: 'audit-desktop', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
});
