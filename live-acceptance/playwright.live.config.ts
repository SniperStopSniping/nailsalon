import { defineConfig, devices } from '@playwright/test';

import { assertLocalAcceptanceEnvironment } from './safety';

const scope = assertLocalAcceptanceEnvironment(process.env);

export default defineConfig({
  expect: { timeout: 30_000 },
  fullyParallel: false,
  outputDir: `${scope.evidenceDirectory}/${scope.runId}/pw-output`,
  projects: [
    { name: 'setup', testMatch: /clerk\.setup\.ts/ },
    {
      dependencies: ['setup'],
      name: 'chromium-live',
      testMatch: /premium-gate\.live\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      dependencies: ['setup'],
      name: 'webkit-live',
      testMatch: /premium-gate\.live\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
  reporter: [['list']],
  retries: 0,
  testDir: __dirname,
  timeout: 420_000,
  use: {
    baseURL: scope.baseURL,
    navigationTimeout: 90_000,
    screenshot: 'only-on-failure',
    // Auth traces contain session material and typed passwords. Screenshots
    // and sanitized assertion evidence are sufficient for this gate.
    trace: 'off',
    video: 'retain-on-failure',
    viewport: { height: 844, width: 390 },
  },
  workers: 1,
});
