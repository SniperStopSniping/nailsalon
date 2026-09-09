import { defineConfig, devices } from '@playwright/test';

import base from './playwright.config';

export default defineConfig({
  ...base,
  outputDir: '/tmp/luster-booking-confirmation-browser-results',
  testMatch: /onboarding-booking-confirmation\.spec\.ts/u,
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
