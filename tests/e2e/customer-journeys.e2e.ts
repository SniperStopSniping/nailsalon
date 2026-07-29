import { expect, type Page, test } from '@playwright/test';

import { appPath, appPathPattern, e2eConfig } from './support/config';

const SERVICE_ID_CANDIDATES = Array.from(new Set([
  e2eConfig.serviceId,
  'svc_biab-short',
  'srv_biab-short',
]));
const LEGACY_AUTH_PATHS = new Set([
  '/api/auth/validate-session',
  '/api/auth/send-otp',
  '/api/auth/verify-otp',
]);

async function resolveWorkingServiceId(page: Page): Promise<string> {
  for (const serviceId of SERVICE_ID_CANDIDATES) {
    await page.goto(`${appPath('/book/confirm')}?salonSlug=${e2eConfig.salonSlug}&serviceIds=${serviceId}&techId=any&date=2030-03-20&time=10:00`);

    const reviewVisible = await page.getByRole('heading', { name: /review your appointment/i }).isVisible({ timeout: 3000 }).catch(() => false);

    if (reviewVisible) {
      return serviceId;
    }
  }

  throw new Error('Could not find a seeded booking service id for browser coverage.');
}

async function installLegacyAuthTripwire(page: Page) {
  const requests: string[] = [];

  await page.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!LEGACY_AUTH_PATHS.has(path)) {
      await route.fallback();
      return;
    }

    requests.push(path);
    await route.fulfill({
      status: 410,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
          message: 'Customer sign-in is unavailable.',
        },
      }),
    });
  });

  return requests;
}

async function seedStaleLegacyCustomerCookies(page: Page) {
  await page.goto('/robots.txt');
  const origin = new URL(page.url()).origin;

  await page.context().addCookies([
    {
      name: 'client_session',
      value: 'stale-e2e-session',
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
    {
      name: 'client_phone',
      value: '4165550000',
      url: origin,
      sameSite: 'Lax',
    },
    {
      name: 'client_name',
      value: 'StaleCustomer',
      url: origin,
      sameSite: 'Lax',
    },
    {
      name: 'client_email',
      value: 'stale@example.com',
      url: origin,
      sameSite: 'Lax',
    },
  ]);
}

async function acknowledgeBookingPolicyWhenRequired(page: Page) {
  const acknowledgment = page.getByTestId('booking-policy-acknowledgment');
  if (await acknowledgment.isVisible().catch(() => false)) {
    await acknowledgment.getByRole('checkbox').check();
  }
}

test.describe('Customer journeys', () => {
  test('stale legacy auth cannot establish identity and guest booking still confirms', async ({ page }) => {
    const legacyAuthRequests = await installLegacyAuthTripwire(page);
    await seedStaleLegacyCustomerCookies(page);

    let appointmentPostCount = 0;
    let postedBody: Record<string, unknown> | null = null;
    let appointmentCookieHeader = '';

    await page.route('**/api/appointments', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }

      appointmentPostCount += 1;
      postedBody = route.request().postDataJSON() as Record<string, unknown>;
      appointmentCookieHeader = route.request().headers().cookie ?? '';

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            appointmentId: 'appt_confirmed_1',
            appointment: {
              id: 'appt_confirmed_1',
            },
            manageUrl: appPath('/manage/stale-cookie-test-token'),
          },
        }),
      });
    });

    const serviceId = await resolveWorkingServiceId(page);

    await page.goto(`${appPath('/book/confirm')}?salonSlug=${e2eConfig.salonSlug}&serviceIds=${serviceId}&techId=any&date=2030-03-20&time=10:00`);

    await expect(page.getByRole('heading', { name: /review your appointment/i })).toBeVisible();
    await expect(page.getByTestId('signed-in-notice')).toHaveCount(0);
    await expect(page.getByLabel('Customer name')).toHaveValue('');
    await expect(page.getByLabel('Customer email')).toHaveValue('');
    await expect(page.getByLabel('Customer phone')).toHaveValue('');
    await expect(page.getByLabel('Customer phone')).toBeEditable();

    await page.getByLabel('Customer name').fill('Fresh Guest');
    await page.getByLabel('Customer email').fill('fresh@example.com');
    await page.getByLabel('Customer phone').fill('6475550199');

    await acknowledgeBookingPolicyWhenRequired(page);

    await page.getByRole('button', { name: /confirm appointment/i }).click();

    await expect.poll(() => appointmentPostCount).toBe(1);
    await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /manage this appointment/i })).toBeVisible();

    expect(postedBody?.serviceIds).toEqual([serviceId]);
    expect(postedBody?.salonSlug).toBe(e2eConfig.salonSlug);
    expect(postedBody?.clientName).toBe('Fresh Guest');
    expect(postedBody?.clientEmail).toBe('fresh@example.com');
    expect(postedBody?.clientPhone).toBe('6475550199');
    expect(JSON.stringify(postedBody)).not.toContain('StaleCustomer');
    expect(JSON.stringify(postedBody)).not.toContain('stale@example.com');
    expect(JSON.stringify(postedBody)).not.toContain('4165550000');
    expect(appointmentCookieHeader).toContain('client_session=stale-e2e-session');
    expect(legacyAuthRequests).toEqual([]);
  });

  test('time selection keeps tenant context and advances to confirmation', async ({ page }) => {
    const legacyAuthRequests = await installLegacyAuthTripwire(page);

    await page.route('**/api/appointments/availability**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          visibleSlots: ['10:00', '10:30'],
          bookedSlots: [],
        }),
      });
    });

    const serviceId = await resolveWorkingServiceId(page);
    await page.goto(`${appPath('/book/time')}?salonSlug=${e2eConfig.salonSlug}&serviceIds=${serviceId}&techId=any`);

    await expect(page.getByText('Pick Your Time')).toBeVisible();

    await expect(page.getByRole('button', { name: '10:00 AM' })).toBeVisible();

    await page.getByRole('button', { name: '10:00 AM' }).click();

    await expect(page).toHaveURL(appPathPattern('/book/confirm'));
    await expect(page).toHaveURL(/time=10%3A00|time=10:00/);

    const confirmationUrl = new URL(page.url());

    expect([
      ...confirmationUrl.pathname.split('/'),
      confirmationUrl.searchParams.get('salonSlug'),
    ]).toContain(e2eConfig.salonSlug);
    expect(legacyAuthRequests).toEqual([]);
  });
});
