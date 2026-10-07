import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.AVAILABILITY_REVIEW_BASE_URL ?? 'http://localhost:3121';
const target = new URL(baseURL);
if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname)) {
  throw new Error('Availability review requires an isolated loopback app.');
}

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../../test-results/availability-recovery',
  use: { baseURL, timezoneId: 'America/Toronto', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
});
