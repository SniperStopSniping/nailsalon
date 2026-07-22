import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });

if (process.env.CI && !process.env.CLERK_SECRET_KEY) {
  process.env.CLERK_SECRET_KEY = 'test_clerk_secret_key';
}

// Use explicit local host/port defaults for browser tests to avoid collisions
// with other dev servers and to keep Playwright traffic loopback-only.
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 3000;
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL?.trim();
const usingExternalBaseUrl = Boolean(EXTERNAL_BASE_URL);

process.env.HOST ||= HOST;
process.env.PORT ||= String(PORT);
process.env.SUPER_ADMIN_TEST_PHONE ||= process.env.E2E_SUPER_ADMIN_PHONE;
process.env.SUPER_ADMIN_TEST_PASSWORD ||= process.env.E2E_SUPER_ADMIN_PASSWORD;

if (process.env.CI && process.env.E2E_USE_REAL_TWILIO !== 'true') {
  process.env.E2E_INSECURE_COOKIES = 'true';
}

// Browser tests never contact Twilio unless a developer makes the explicit,
// exceptional choice to opt in. This applies locally as well as in CI because
// `.env.local` may contain a working sender configuration.
if (process.env.E2E_USE_REAL_TWILIO !== 'true') {
  process.env.TWILIO_ACCOUNT_SID = '';
  process.env.TWILIO_AUTH_TOKEN = '';
  process.env.TWILIO_VERIFY_SERVICE_SID = '';
  process.env.TWILIO_PHONE_NUMBER = '';
}

const chromiumUse = {
  ...devices['Desktop Chrome'],
  channel: 'chromium' as const,
  launchOptions: {
    args: ['--headless=new'],
  },
};

// Set webServer.url and use.baseURL with the location of the WebServer respecting the correct set port
const baseURL = EXTERNAL_BASE_URL || `http://${HOST}:${PORT}`;
// The deployment health endpoint intentionally returns 503 when required hosted
// integrations are absent. CI only needs to know that Next.js is accepting
// requests before tests start, so use a static liveness route for this probe.
const webServerReadyURL = `${baseURL}/robots.txt`;
process.env.PUBLIC_APP_URL ||= baseURL;

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
        command: `npm run start -- --hostname ${HOST} --port ${PORT}`,
        url: webServerReadyURL,
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
      grepInvert: /@mobile-safari/,
    },
    {
      name: 'mobile-webkit',
      testMatch: /mobile-(?:booking-footer|admin-appointment-sheet)\.e2e\.ts/,
      grep: /@mobile-safari/,
      use: { ...devices['iPhone 13'] },
      dependencies: ['setup'],
    },
    ...(process.env.CI
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
            dependencies: ['setup'],
            grepInvert: /@mobile-(?:chrome|safari)/,
          },
        ]
      : []),
  ],
});
