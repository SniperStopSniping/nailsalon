import { defineConfig, devices } from '@playwright/test';

const labUrl = 'http://127.0.0.1:4188';
const captureEvidence = process.env.LUSTER_CAPTURE_EVIDENCE === '1';

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: '/tmp/luster-onboarding-final-corrections/playwright',
  reporter: [
    ['line'],
    ['html', {
      open: 'never',
      outputFolder: '/tmp/luster-onboarding-final-corrections/playwright-report',
    }],
  ],
  retries: 0,
  testDir: './tests/e2e',
  testMatch: /onboarding-v1-final-corrections\.spec\.ts/u,
  timeout: 120_000,
  use: {
    baseURL: labUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: captureEvidence ? 'on' : 'retain-on-failure',
  },
  webServer: {
    command: 'VITE_LUSTER_BUILDER_TEST_HARNESS=1 npm run dev',
    reuseExistingServer: true,
    timeout: 90_000,
    url: labUrl,
  },
  workers: 1,
  projects: [
    {
      name: 'chromium-onboarding-final',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
      },
    },
    {
      grep: /@webkit-smoke/u,
      name: 'webkit-onboarding-upload',
      use: {
        ...devices['Desktop Safari'],
        hasTouch: true,
      },
    },
  ],
});
