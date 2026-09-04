import { defineConfig, devices } from '@playwright/test';

import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  outputDir: '/tmp/luster-onboarding-mobile-keyboard/playwright',
  testMatch: /mobile-keyboard\.spec\.ts/u,
  projects: [
    {
      name: 'chromium-mobile-keyboard',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    {
      name: 'webkit-mobile-keyboard',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
