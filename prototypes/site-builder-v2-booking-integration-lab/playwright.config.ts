import { defineConfig, devices } from '@playwright/test';

const labPort = process.env.LUSTER_LAB_PORT ?? '4188';
const labUrl = process.env.LUSTER_LAB_URL ?? `http://127.0.0.1:${labPort}`;

export default defineConfig({
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: '/tmp/luster-onboarding-v1-ux-lab/playwright',
  reporter: [['line']],
  retries: 0,
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: labUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `VITE_LUSTER_BUILDER_TEST_HARNESS=1 npm run dev -- --port ${labPort}`,
    reuseExistingServer: false,
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
