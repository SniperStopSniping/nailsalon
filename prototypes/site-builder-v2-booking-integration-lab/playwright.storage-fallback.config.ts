import { defineConfig, devices } from '@playwright/test';

import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: './tests/storage',
  testMatch: /webkit-storage-fallback\.spec\.ts/,
  projects: [
    {
      name: 'chromium-storage',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        hasTouch: true,
      },
    },
    {
      name: 'webkit-storage',
      use: {
        ...devices['Desktop Safari'],
        hasTouch: true,
      },
    },
  ],
});
