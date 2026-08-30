import { clerkSetup } from '@clerk/testing/playwright';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  globalSetup: require.resolve('./global-setup'),
  outputDir: '/tmp/luster-premium-account-gate/evidence/pw-output',
  projects: [
    {
      name: 'chromium-live',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit-live',
      use: { ...devices['iPhone 13'] },
    },
  ],
  reporter: [['list']],
  retries: 0,
  testDir: __dirname,
  testMatch: '**/*.live.spec.ts',
  timeout: 420_000,
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? 'http://127.0.0.1:4191',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    viewport: { height: 844, width: 390 },
  },
  workers: 1,
});

export { clerkSetup };
