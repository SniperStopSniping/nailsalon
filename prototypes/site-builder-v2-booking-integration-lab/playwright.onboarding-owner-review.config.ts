import { defineConfig, devices } from '@playwright/test';

const labUrl = 'http://127.0.0.1:4188';
const evidenceDirectory = process.env.LUSTER_EVIDENCE_DIRECTORY
  ?? '/tmp/luster-onboarding-owner-review-corrections';
const captureEvidence = process.env.LUSTER_CAPTURE_EVIDENCE === '1';

export default defineConfig({
  expect: { timeout: 12_000 },
  fullyParallel: false,
  outputDir: `${evidenceDirectory}/playwright-owner-review`,
  reporter: [
    ['line'],
    ['html', {
      open: 'never',
      outputFolder: `${evidenceDirectory}/playwright-owner-review-report`,
    }],
  ],
  retries: 0,
  testDir: './tests/e2e',
  testMatch: /onboarding-owner-review\.spec\.ts/u,
  timeout: 180_000,
  use: {
    actionTimeout: 12_000,
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
      grepInvert: /@webkit-smoke/u,
      name: 'chromium-owner-review',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
      },
    },
    {
      grep: /@webkit-smoke/u,
      name: 'webkit-owner-review-media',
      use: {
        ...devices['Desktop Safari'],
        hasTouch: true,
      },
    },
  ],
});
