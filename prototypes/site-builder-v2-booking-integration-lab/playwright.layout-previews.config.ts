import { defineConfig, devices } from '@playwright/test';

import base from './playwright.config';

export default defineConfig({
  ...base,
  outputDir: '/tmp/luster-layout-preview-browser-results',
  testMatch: /onboarding-(?:layout-previews|design-recovery)\.spec\.ts/u,
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'small-mobile-webkit', use: { ...devices['iPhone SE'], viewport: { width: 320, height: 568 } } },
  ],
});
