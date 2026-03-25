import { expect, test, type Page } from '@playwright/test';

const SALON_SLUG = 'nail-salon-no5';
const SERVICE_ID_CANDIDATES = ['svc_biab-short', 'srv_biab-short'];

async function resolveWorkingServiceId(page: Page): Promise<string> {
  for (const serviceId of SERVICE_ID_CANDIDATES) {
    await page.goto(`/book/confirm?salonSlug=${SALON_SLUG}&serviceIds=${serviceId}&techId=any&date=2030-03-20&time=10:00`);

    const sessionPromptVisible = await page.getByText('Sign in to finish booking').isVisible({ timeout: 3000 }).catch(() => false);
    const reviewVisible = await page.getByRole('heading', { name: /review your appointment/i }).isVisible({ timeout: 3000 }).catch(() => false);

    if (sessionPromptVisible || reviewVisible) {
      return serviceId;
    }
  }

  throw new Error('Could not find a seeded booking service id for browser coverage.');
}

test.describe('Customer journeys', () => {
  test('session-gated booking confirmation verifies once and confirms successfully', async ({ page }) => {
    let isLoggedIn = false;
    let sendOtpCount = 0;
    let verifyOtpCount = 0;
    let appointmentPostCount = 0;
    let postedBody: Record<string, unknown> | null = null;

    await page.route('**/api/auth/validate-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          isLoggedIn
            ? {
                valid: true,
                phone: '+14165551234',
                clientName: 'Ava',
                clientEmail: 'ava@example.com',
              }
            : {
                valid: false,
                reason: 'No session cookie',
              },
        ),
      });
    });

    await page.route('**/api/auth/send-otp', async (route) => {
      sendOtpCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route('**/api/auth/verify-otp', async (route) => {
      verifyOtpCount += 1;
      isLoggedIn = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          phone: '+14165551234',
        }),
      });
    });

    await page.route('**/api/appointments', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }

      appointmentPostCount += 1;
      postedBody = route.request().postDataJSON() as Record<string, unknown>;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            appointment: {
              id: 'appt_confirmed_1',
            },
          },
        }),
      });
    });

    const serviceId = await resolveWorkingServiceId(page);

    await page.goto(`/book/confirm?salonSlug=${SALON_SLUG}&serviceIds=${serviceId}&techId=any&date=2030-03-20&time=10:00`);

    await expect(page.getByText('Sign in to finish booking')).toBeVisible();

    await page.getByPlaceholder('Phone number').fill('4165551234');
    await expect.poll(() => sendOtpCount).toBe(1);

    await expect(page.getByText(/Enter the 6-digit code we sent/i)).toBeVisible();
    await page.getByPlaceholder('• • • • • •').fill('123456');
    await expect.poll(() => verifyOtpCount).toBe(1);

    await expect(page.getByRole('heading', { name: /review your appointment/i })).toBeVisible();
    await page.getByRole('button', { name: /confirm appointment/i }).click();

    await expect.poll(() => appointmentPostCount).toBe(1);
    await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /manage this appointment/i })).toBeVisible();

    expect(postedBody?.serviceIds).toEqual([serviceId]);
    expect(postedBody?.salonSlug).toBe(SALON_SLUG);
  });

  test('time selection keeps tenant context and advances to confirmation', async ({ page }) => {
    await page.route('**/api/auth/validate-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          valid: true,
          phone: '+14165551234',
          clientName: 'Ava',
          clientEmail: 'ava@example.com',
        }),
      });
    });

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
    await page.goto(`/book/time?salonSlug=${SALON_SLUG}&serviceIds=${serviceId}&techId=any`);

    await expect(page.getByText('Pick Your Time')).toBeVisible();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page.getByRole('button', { name: new RegExp(`^${tomorrow.getDate()}$`) }).click();

    await expect(page.getByRole('button', { name: '10:00 AM' })).toBeVisible();
    await page.getByRole('button', { name: '10:00 AM' }).click();

    await expect(page).toHaveURL(new RegExp(`/book/confirm\\?[^#]*salonSlug=${SALON_SLUG}`));
    await expect(page).toHaveURL(/time=10%3A00|time=10:00/);
  });

  test('profile manage-booking flow preserves tenant context and can cancel', async ({ page }) => {
    const serviceId = await resolveWorkingServiceId(page);
    let cancelled = false;

    await page.route('**/api/auth/validate-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          valid: true,
          phone: '+14165551234',
          clientName: 'Ava',
          clientEmail: 'ava@example.com',
        }),
      });
    });

    await page.route('**/api/client/next-appointment**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: cancelled
            ? {
                appointment: null,
                services: [],
                technician: null,
              }
            : {
                appointment: {
                  id: 'appt_live_1',
                  startTime: '2030-03-21T15:00:00.000Z',
                  endTime: '2030-03-21T16:15:00.000Z',
                  status: 'confirmed',
                  totalPrice: 6500,
                  totalDurationMinutes: 75,
                  locationId: null,
                },
                services: [
                  {
                    id: serviceId,
                    name: 'BIAB Short',
                    price: 65,
                    duration: 75,
                    imageUrl: null,
                  },
                ],
                technician: null,
              },
        }),
      });
    });

    await page.route('**/api/rewards**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          meta: {
            activePoints: 2500,
          },
        }),
      });
    });

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

    await page.route('**/api/appointments/appt_live_1/cancel', async (route) => {
      cancelled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            appointment: {
              id: 'appt_live_1',
              status: 'cancelled',
            },
          },
        }),
      });
    });

    await page.goto(`/profile?salonSlug=${SALON_SLUG}`);

    await expect(page.getByRole('button', { name: /manage booking/i })).toBeVisible();
    await page.getByRole('button', { name: /manage booking/i }).click();

    await expect(page).toHaveURL(new RegExp(`/change-appointment\\?[^#]*salonSlug=${SALON_SLUG}`));
    await expect(page).toHaveURL(/originalAppointmentId=appt_live_1/);

    await page.getByRole('button', { name: /cancel appointment/i }).click();
    await page.getByRole('button', { name: /yes, cancel/i }).click();

    await expect(page).toHaveURL(new RegExp(`/profile\\?[^#]*cancelled=true[^#]*salonSlug=${SALON_SLUG}`));
    await expect(page.getByText('When you are ready, reserve your next appointment.')).toBeVisible();
  });
});
