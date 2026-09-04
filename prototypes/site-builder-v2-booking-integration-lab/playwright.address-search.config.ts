import { defineConfig, devices } from '@playwright/test';

import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testMatch: /address-search\.spec\.ts/u,
  projects: [
    {
      name: 'chromium-address-search',
      use: { ...devices['Desktop Chrome'], channel: 'chromium', hasTouch: true },
    },
    {
      name: 'webkit-address-search',
      use: { ...devices['Desktop Safari'], hasTouch: true },
    },
  ],
});
