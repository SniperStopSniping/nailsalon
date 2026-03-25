import { defineConfig, devices } from '@playwright/test';

// Use explicit local host/port defaults for browser tests to avoid collisions
// with other dev servers and to keep Playwright traffic loopback-only.
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 3000;
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL?.trim();
const usingExternalBaseUrl = Boolean(EXTERNAL_BASE_URL);
const chromiumUse = {
  ...devices['Desktop Chrome'],
  channel: 'chromium' as const,
  launchOptions: {
    args: ['--headless=new'],
  },
};

// Set webServer.url and use.baseURL with the location of the WebServer respecting the correct set port
const baseURL = EXTERNAL_BASE_URL || `http://${HOST}:${PORT}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  // Look for files with the .spec.js or .e2e.js extension
  testMatch: '*.@(spec|e2e).?(c|m)[jt]s?(x)',
  // Timeout per test
  timeout: usingExternalBaseUrl ? 90 * 1000 : 30 * 1000,
  workers: 1,
  retries: process.env.CI || usingExternalBaseUrl ? 1 : 0,
  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  // Reporter to use. See https://playwright.dev/docs/test-reporters
  reporter: process.env.CI ? 'github' : 'list',

  expect: {
    // Set timeout for async expect matchers
    timeout: usingExternalBaseUrl ? 15 * 1000 : 10 * 1000,
  },

  // Run your local dev server before starting the tests:
  // https://playwright.dev/docs/test-advanced#launching-a-development-web-server-during-the-tests
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        command: process.env.CI
          ? `npm run start -- --hostname ${HOST} --port ${PORT}`
          : `npm run dev:next -- --hostname ${HOST} --port ${PORT}`,
        url: baseURL,
        timeout: 5 * 60 * 1000,
        reuseExistingServer: !process.env.CI,
      },

  // Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions.
  use: {
    // Use baseURL so to make navigations relative.
    // More information: https://playwright.dev/docs/api/class-testoptions#test-options-base-url
    baseURL,
    navigationTimeout: usingExternalBaseUrl ? 45 * 1000 : 30 * 1000,

    // Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer
    trace: process.env.CI || usingExternalBaseUrl ? 'retain-on-failure' : undefined,

    // Record videos when retrying the failed test.
    video: process.env.CI || usingExternalBaseUrl ? 'retain-on-failure' : undefined,
  },

  projects: [
    // `setup` and `teardown` are used to run code before and after all E2E tests.
    // These functions can be used to configure Clerk for testing purposes. For example, bypassing bot detection.
    // In the `setup` file, you can create an account in `Test mode`.
    // For each test, an organization can be created within this account to ensure total isolation.
    // After all tests are completed, the `teardown` file can delete the account and all associated organizations.
    // You can find the `setup` and `teardown` files at: https://nextjs-boilerplate.com/pro-saas-starter-kit
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      teardown: 'teardown',
      use: chromiumUse,
    },
    { name: 'teardown', testMatch: /.*\.teardown\.ts/, use: chromiumUse },
    {
      name: 'chromium',
      use: chromiumUse,
      dependencies: ['setup'],
    },
    ...(process.env.CI
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
            dependencies: ['setup'],
          },
        ]
      : []),
  ],
});
