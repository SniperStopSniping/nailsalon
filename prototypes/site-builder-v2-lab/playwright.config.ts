import { defineConfig, devices } from '@playwright/test';

const labUrl = 'http://127.0.0.1:4179';

export default defineConfig({
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: 'artifacts/playwright',
  reporter: [['line']],
  retries: 0,
  testDir: './tests/e2e',
  timeout: 45_000,
  use: {
    baseURL: labUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 4179',
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
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'], channel: 'chromium' },
    },
  ],
});
