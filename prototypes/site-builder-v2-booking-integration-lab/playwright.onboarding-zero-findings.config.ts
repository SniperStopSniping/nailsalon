import { defineConfig, devices } from '@playwright/test';

const labPort = process.env.LUSTER_LAB_PORT ?? '4188';
const labUrl = process.env.LUSTER_LAB_URL ?? `http://127.0.0.1:${labPort}`;
const captureEvidence = process.env.LUSTER_CAPTURE_EVIDENCE === '1';

export default defineConfig({
  expect: { timeout: 12_000 },
  fullyParallel: false,
  outputDir: '/tmp/luster-onboarding-zero-findings-correction/playwright',
  reporter: [
    ['line'],
    ['html', {
      open: 'never',
      outputFolder: '/tmp/luster-onboarding-zero-findings-correction/playwright-report',
    }],
  ],
  retries: 0,
  testDir: './tests/e2e',
  testMatch: /onboarding-zero-findings\.spec\.ts/u,
  timeout: 180_000,
  use: {
    actionTimeout: 12_000,
    baseURL: labUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: captureEvidence ? 'on' : 'retain-on-failure',
  },
  webServer: {
    command: `VITE_LUSTER_BUILDER_TEST_HARNESS=1 npm run dev -- --port ${labPort}`,
    reuseExistingServer: true,
    timeout: 90_000,
    url: labUrl,
  },
  workers: 1,
  projects: [
    {
      grepInvert: /@webkit-smoke/u,
      name: 'chromium-zero-findings',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
      },
    },
    {
      grep: /@webkit-smoke/u,
      name: 'webkit-zero-findings-upload',
      use: {
        ...devices['Desktop Safari'],
        hasTouch: true,
      },
    },
  ],
});
