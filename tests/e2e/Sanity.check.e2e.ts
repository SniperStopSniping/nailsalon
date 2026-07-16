import { expect, test } from '@playwright/test';

import { e2eConfig, usingExternalBaseUrl } from './support/config';

// Checkly is a tool used to monitor deployed environments, such as production or preview environments.
// It runs end-to-end tests with the `.check.e2e.ts` extension after each deployment to ensure that the environment is up and running.
// With Checkly, you can monitor your production environment and run `*.check.e2e.ts` tests regularly at a frequency of your choice.
// If the tests fail, Checkly will notify you via email, Slack, or other channels of your choice.
// On the other hand, E2E tests ending with `*.e2e.ts` are only run before deployment.
// You can run them locally or on CI to ensure that the application is ready for deployment.

// BaseURL needs to be explicitly defined in the test file.
// Otherwise, Checkly runtime will throw an exception: `CHECKLY_INVALID_URL: Only URL's that start with http(s)`
// You can't use `goto` function directly with a relative path like with other *.e2e.ts tests.
// Check the example at https://feedback.checklyhq.com/changelog/new-changelog-436

test.describe('Sanity', () => {
  test('critical production services report healthy', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(`${baseURL}/api/health`);

    expect(response.status()).toBe(200);

    const health = await response.json();

    expect(health.status).toBe('ok');
    expect(health.checks).toMatchObject({
      db: true,
      clerkEnv: true,
      passwordAuthEnv: true,
    });

    if (usingExternalBaseUrl()) {
      expect(health.checks).toMatchObject({
        redis: true,
        resendVerified: true,
        googleCalendarEnv: true,
      });
    }
  });

  test.describe('Static pages', () => {
    test('should display the booking service page', async ({
      page,
      baseURL,
    }) => {
      await page.goto(
        `${baseURL}/book/service?salonSlug=${e2eConfig.salonSlug}`,
        {
          waitUntil: 'domcontentloaded',
        },
      );

      await expect(
        page.getByRole('heading', { name: /choose your service/i }),
      ).toBeVisible();
    });

    test('owner sign-in is available and Luster branded', async ({
      page,
      baseURL,
    }) => {
      await page.goto(`${baseURL}/owner-sign-in`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.getByText('Luster', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /salon owner sign in/i }),
      ).toBeVisible();
    });

    test('clients can recover a private booking link', async ({
      page,
      baseURL,
    }) => {
      await page.goto(`${baseURL}/${e2eConfig.salonSlug}/find-booking`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(
        page.getByRole('heading', { name: /find my booking/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /email my booking links/i }),
      ).toBeVisible();
    });
  });
});
