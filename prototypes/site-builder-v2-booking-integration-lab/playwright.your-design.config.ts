import { defineConfig, devices } from '@playwright/test';

import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'your-design-guided.spec.ts',
  outputDir: '/tmp/luster-your-design-browser-results',
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone-chromium', use: { ...devices['Pixel 5'] } },
    { name: 'phone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'small-phone-webkit', use: { ...devices['iPhone SE'] } },
  ],
});
