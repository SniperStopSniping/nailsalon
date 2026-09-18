import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

process.env.E2E_SALON_SLUG = 'synthetic-l1-public-e2e';
process.env.HOST = 'localhost';
process.env.PORT = '3101';

export default defineConfig({
  timeout: 90_000,
  webServer: process.env.L1_PUBLIC_BOOKING_EXTERNAL_SERVER === 'true' ? undefined : { command: 'npm run start -- --hostname localhost --port 3101', url: 'http://localhost:3101/robots.txt', timeout: 120_000, reuseExistingServer: !process.env.CI },
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: path.join(process.cwd(), 'test-results/l1-public-booking'),
  use: { baseURL: 'http://localhost:3101', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
