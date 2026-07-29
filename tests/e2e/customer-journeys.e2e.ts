import { expect, type Page, test } from '@playwright/test';

import { appPath, appPathPattern, e2eConfig } from './support/config';

const SERVICE_ID_CANDIDATES = Array.from(new Set([
  e2eConfig.serviceId,
  'svc_biab-short',
  'srv_biab-short',
]));
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

async function installRetiredCustomerTrafficTripwires(page: Page) {
  const legacyAuthRequests = await installLegacyAuthTripwire(page);
  const protectedCustomerRequests: string[] = [];
  const referralRequests: string[] = [];

  const installTripwire = async (pattern: RegExp, requests: string[]) => {
    await page.route(pattern, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;

      requests.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'E2E_RETIRED_CUSTOMER_TRAFFIC_TRIPWIRE',
            message: 'Retired customer pages must not call legacy customer APIs.',
          },
        }),
      });
    });
  };

  await installTripwire(
    /\/api\/(?:client(?:[/?#]|$)|appointments\/history(?:[/?#]|$)|rewards(?:[/?#]|$)|gallery(?:[/?#]|$))/,
    protectedCustomerRequests,
  );
  await installTripwire(
    /\/api\/referrals(?:[/?#]|$)/,
    referralRequests,
  );

  return {
    legacyAuthRequests,
    protectedCustomerRequests,
    referralRequests,
  };
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
  test('retired change-appointment entry points return not found without legacy auth traffic', async ({ page }) => {
    const legacyAuthRequests = await installLegacyAuthTripwire(page);
    const retiredPaths = [
      `/change-appointment?salonSlug=${e2eConfig.salonSlug}`,
      `/fr/change-appointment?salonSlug=${e2eConfig.salonSlug}`,
      `/fr/${e2eConfig.salonSlug}/change-appointment`,
    ];

    for (const retiredPath of retiredPaths) {
      const response = await page.goto(retiredPath);

      expect(response?.status(), `${retiredPath} should return HTTP 404`).toBe(404);
      await expect(page.getByText(/change your appointment/i)).toHaveCount(0);
    }

    expect(legacyAuthRequests).toEqual([]);
  });

  test('remaining legacy customer pages return direct 404s without customer API traffic', async ({ page }) => {
    const traffic = await installRetiredCustomerTrafficTripwires(page);
    const syntheticReferralId = 'ref_e2e_retired_0b2';
    const retiredPaths = [
      {
        label: 'root profile',
        path: `/profile?salonSlug=${e2eConfig.salonSlug}`,
      },
      {
        label: 'locale appointment history',
        path: `/fr/appointments/history?salonSlug=${e2eConfig.salonSlug}`,
      },
      {
        label: 'locale tenant rewards',
        path: `/fr/${e2eConfig.salonSlug}/rewards`,
      },
      {
        label: 'synthetic referral claim',
        path: `/referral/${syntheticReferralId}?salonSlug=${e2eConfig.salonSlug}`,
      },
      {
        label: 'root payment methods',
        path: `/payment-methods?salonSlug=${e2eConfig.salonSlug}`,
      },
    ];

    for (const retiredPath of retiredPaths) {
      const response = await page.goto(retiredPath.path);

      expect(
        response?.status(),
        `${retiredPath.label} (${retiredPath.path}) should return HTTP 404`,
      ).toBe(404);
      await expect(page.locator('body')).toContainText(/404|not found|could not be found/i);
      await expect(
        page.locator(
          'input[type="tel"], input[name*="phone" i], input[autocomplete="one-time-code"]',
        ),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', {
          name: /send (?:me )?(?:a )?code|verify code|claim referral|save profile|add payment method/i,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('heading', {
          name: /profile|appointment history|rewards|payment methods|claim your/i,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          /sign in with your booking phone|verification code|how points work|rewards apply automatically|beauty profile|my referrals|loading your referral|already claimed|referral details/i,
        ),
      ).toHaveCount(0);
      await expect(page.getByText(syntheticReferralId, { exact: false })).toHaveCount(0);

      expect(traffic.legacyAuthRequests, `${retiredPath.label} must not call /api/auth/*`).toEqual([]);
      expect(
        traffic.protectedCustomerRequests,
        `${retiredPath.label} must not call protected customer APIs`,
      ).toEqual([]);
      expect(
        traffic.referralRequests,
        `${retiredPath.label} must not look up or claim a referral`,
      ).toEqual([]);
    }
  });

  test('stale legacy auth cannot establish identity and guest booking still confirms', async ({ page }) => {
    const legacyAuthRequests = await installLegacyAuthTripwire(page);
    await seedStaleLegacyCustomerCookies(page);

    let appointmentPostCount = 0;
    let postedBody: Record<string, unknown> | null = null;
    let appointmentCookieHeader = '';
    const canonicalManageUrl = appPath(`/${e2eConfig.salonSlug}/manage/stale-cookie-test-token`);

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
            manageUrl: canonicalManageUrl,
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

    const manageLink = page.getByRole('link', { name: /manage this appointment/i });

    await expect(manageLink).toBeVisible();
    await expect(manageLink).toHaveAttribute('href', canonicalManageUrl);
    await expect(page.locator('a[href*="/change-appointment"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sign out|book for someone else/i })).toHaveCount(0);
    await expect(page.locator('a[href*="/profile"], a[href*="/rewards"], a[href*="/payment-methods"]')).toHaveCount(0);
    await expect(page.getByText('appt_confirmed_1', { exact: true })).toHaveCount(0);

    expect(postedBody?.serviceIds).toEqual([serviceId]);
    expect(postedBody?.salonSlug).toBe(e2eConfig.salonSlug);
    expect(postedBody?.bookingSubject).toBe('guest');
    expect(postedBody?.clientName).toBe('Fresh Guest');
    expect(postedBody?.clientEmail).toBe('fresh@example.com');
    expect(postedBody?.clientPhone).toBe('6475550199');
    expect(JSON.stringify(postedBody)).not.toContain('StaleCustomer');
    expect(JSON.stringify(postedBody)).not.toContain('stale@example.com');
    expect(JSON.stringify(postedBody)).not.toContain('4165550000');
    expect(appointmentCookieHeader).toContain('client_session=stale-e2e-session');
    expect(legacyAuthRequests).toEqual([]);
  });

  test('confirmation without a manage URL stays successful and offers tenant-safe recovery', async ({ page }) => {
    const legacyAuthRequests = await installLegacyAuthTripwire(page);

    await page.route('**/api/appointments', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            appointmentId: 'appt_without_manage_url',
            appointment: {
              id: 'appt_without_manage_url',
            },
          },
        }),
      });
    });

    const serviceId = await resolveWorkingServiceId(page);
    await page.goto(`${appPath('/book/confirm')}?salonSlug=${e2eConfig.salonSlug}&serviceIds=${serviceId}&techId=any&date=2030-03-20&time=10:00`);

    await page.getByLabel('Customer name').fill('Recovery Guest');
    await page.getByLabel('Customer email').fill('recovery@example.com');
    await page.getByLabel('Customer phone').fill('6475550188');
    await acknowledgeBookingPolicyWhenRequired(page);
    await page.getByRole('button', { name: /confirm appointment/i }).click();

    await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(/private management link is not available/i);

    const recoveryLink = page.getByRole('link', { name: /find my booking to receive a secure management link/i });

    await expect(recoveryLink).toBeVisible();

    const recoveryHref = await recoveryLink.getAttribute('href');

    expect(recoveryHref).not.toBeNull();

    const recoveryUrl = new URL(recoveryHref!, page.url());

    expect(recoveryUrl.pathname).toMatch(appPathPattern('/find-booking'));
    expect([
      ...recoveryUrl.pathname.split('/'),
      recoveryUrl.searchParams.get('salonSlug'),
    ]).toContain(e2eConfig.salonSlug);

    await expect(page.getByRole('link', { name: /manage this appointment/i })).toHaveCount(0);
    await expect(page.locator('a[href*="/change-appointment"]')).toHaveCount(0);
    await expect(page.getByText('appt_without_manage_url', { exact: true })).toHaveCount(0);
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

  test('tech booking remains usable on mobile without the retired floating dock', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const legacyAuthRequests = await installLegacyAuthTripwire(page);
    const serviceId = await resolveWorkingServiceId(page);

    await page.goto(`${appPath('/book/tech')}?salonSlug=${e2eConfig.salonSlug}&serviceIds=${serviceId}`);

    await expect(page.getByRole('heading', { name: /choose your artist/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: /bottom navigation/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /go to invite|go to rewards|go to profile/i })).toHaveCount(0);

    const anyArtist = page.getByRole('button', { name: /surprise me with any available artist/i });

    await expect(anyArtist).toBeEnabled();

    await anyArtist.click();

    await expect(page).toHaveURL(appPathPattern('/book/time'));

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );

    expect(horizontalOverflow).toBe(false);
    expect(legacyAuthRequests).toEqual([]);
  });
});
