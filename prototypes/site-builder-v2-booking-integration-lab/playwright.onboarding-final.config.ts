import { defineConfig, devices } from '@playwright/test';

const labPort = process.env.LUSTER_LAB_PORT ?? '4188';
const labUrl = process.env.LUSTER_LAB_URL ?? `http://127.0.0.1:${labPort}`;
const captureEvidence = process.env.LUSTER_CAPTURE_EVIDENCE === '1';
const evidenceDirectory = process.env.LUSTER_EVIDENCE_DIRECTORY
  ?? '/tmp/luster-onboarding-final-corrections';

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: `${evidenceDirectory}/playwright-final-corrections`,
  reporter: [
    ['line'],
    ['html', {
      open: 'never',
      outputFolder: `${evidenceDirectory}/playwright-final-corrections-report`,
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
    command: `VITE_LUSTER_BUILDER_TEST_HARNESS=1 npm run dev -- --port ${labPort}`,
    reuseExistingServer: true,
    timeout: 90_000,
    url: labUrl,
  },
  workers: 1,
  projects: [
    {
      grepInvert: /@webkit-smoke/u,
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
