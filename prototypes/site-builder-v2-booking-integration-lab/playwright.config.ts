import { defineConfig, devices } from '@playwright/test';

const labPort = process.env.LUSTER_LAB_PORT ?? '4188';
const labUrl = process.env.LUSTER_LAB_URL ?? `http://127.0.0.1:${labPort}`;
const captureZeroFindingsEvidence = process.env.LUSTER_CAPTURE_EVIDENCE === '1';

export default defineConfig({
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: captureZeroFindingsEvidence
    ? '/tmp/luster-onboarding-zero-findings-correction/playwright-original'
    : '/tmp/luster-onboarding-final-corrections/playwright-original',
  reporter: [['line']],
  retries: 0,
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: labUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: captureZeroFindingsEvidence ? 'on' : 'retain-on-failure',
  },
  webServer: {
    command: `VITE_LUSTER_BUILDER_TEST_HARNESS=1 npm run dev -- --port ${labPort}`,
    reuseExistingServer: true,
    timeout: 60_000,
    url: labUrl,
  },
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
});
