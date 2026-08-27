import { defineConfig, devices } from '@playwright/test';

const labPort = process.env.LUSTER_LAB_PORT ?? '4186';
const labUrl = process.env.LUSTER_LAB_URL ?? `http://127.0.0.1:${labPort}`;

export default defineConfig({
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: 'artifacts/playwright',
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
    command: `npm run dev -- --port ${labPort}`,
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
