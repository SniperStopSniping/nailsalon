import { expect, type Page, type Route, test } from '@playwright/test';

const SALON_ID = 'synthetic-browser-isla-salon';
const SALON_SLUG = 'isla-nail-studio';
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const RECOVERY_KEY = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_STORAGE_KEY = `luster.public-booking-attempt.v1.${SALON_ID}`;

const confirmProps = {
  services: [{ id: 'gel-manicure', name: 'Gel Manicure', price: 65, duration: 75 }],
  addOns: [],
  baseServiceId: 'gel-manicure',
  selectedAddOns: [],
  subtotalBeforeDiscount: 65,
  discountAmount: 0,
  totalPrice: 65,
  totalDuration: 75,
  technician: { id: 'tech-1', name: 'Taylor', imageUrl: null },
  salonId: SALON_ID,
  salonSlug: SALON_SLUG,
  dateStr: '2030-01-02',
  timeStr: '10:00',
  canonicalStartTime: '2030-01-02T15:00:00.000Z',
  salonTimeZone: 'America/Toronto',
  bookingFlow: [],
  location: null,
};

type SyntheticRoutes = {
  appointmentPosts: unknown[];
  recoveryPosts: unknown[];
  unexpected: string[];
};

function receipt() {
  return {
    data: {
      appointmentId: 'appointment-original',
      appointment: {
        id: 'appointment-original',
        status: 'confirmed',
        startTime: '2030-01-02T15:00:00.000Z',
        totalPrice: 6500,
        totalDurationMinutes: 75,
        bookingTaxSnapshot: { invoiceTotalCents: 6500, currency: 'CAD' },
      },
      services: [{ service: { id: 'gel-manicure', name: 'Gel Manicure' }, priceAtBooking: 6500, durationAtBooking: 75 }],
      addOns: [],
      technician: { id: 'tech-1', name: 'Taylor' },
      manageUrl: 'https://example.test/manage/original',
    },
    meta: { timestamp: '2030-01-01T00:00:00.000Z' },
  };
}

function pendingAttempt() {
  return {
    version: 1,
    salonId: SALON_ID,
    attemptId: ATTEMPT_ID,
    recoveryKey: RECOVERY_KEY,
    confirmationPath: `/en/${SALON_SLUG}/book/confirm`,
    state: 'pending',
  };
}

async function installSyntheticRecoveryRoutes(page: Page, options: {
  appointment?: (route: Route) => Promise<void>;
  recovery?: 'resolved' | 'unresolved';
} = {}): Promise<SyntheticRoutes> {
  const appointmentPosts: unknown[] = [];
  const recoveryPosts: unknown[] = [];
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3130') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (url.pathname === '/api/__fixture/booking-page') {
      await route.fulfill({ json: { stage: 'confirm', props: confirmProps } });
      return;
    }
    if (url.pathname === '/api/appointments' && request.method() === 'POST') {
      appointmentPosts.push(request.postDataJSON());
      if (options.appointment) {
        await options.appointment(route);
      } else {
        await route.fulfill({ status: 201, json: receipt() });
      }
      return;
    }
    if (url.pathname === `/api/public/booking-attempt/${SALON_ID}/status` && request.method() === 'POST') {
      recoveryPosts.push(request.postDataJSON());
      await route.fulfill({ json: options.recovery === 'resolved'
        ? { kind: 'resolved', response: receipt() }
        : { kind: 'unresolved' } });
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.abort();
  });
  return { appointmentPosts, recoveryPosts, unexpected };
}

async function openConfirm(page: Page) {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/en/${SALON_SLUG}/book/confirm`);

  await expect(page.getByRole('heading', { name: 'Review your appointment' })).toBeVisible();
}

async function fillGuestDetails(page: Page) {
  await page.getByLabel('Customer name').fill('Ava');
  await page.getByLabel('Customer email').fill('ava@example.test');
  await page.getByLabel('Customer phone').fill('4165550101');
}

async function seedAttemptBeforeNavigation(page: Page, value: unknown) {
  await page.addInitScript(({ key, attempt }) => sessionStorage.setItem(key, JSON.stringify(attempt)), {
    key: ATTEMPT_STORAGE_KEY,
    attempt: value,
  });
}

test('direct normal confirmation has no recovery banner at 320px', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page);

  await openConfirm(page);

  await expect(page.getByTestId('booking-recovery-notice')).toHaveCount(0);
  expect(routes.appointmentPosts).toEqual([]);
  expect(routes.recoveryPosts).toEqual([]);
  expect(routes.unexpected).toEqual([]);
});

test('a double tap creates one booking POST at 320px', async ({ page }) => {
  let releaseResponse: (() => void) | null = null;
  const responseReady = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const routes = await installSyntheticRecoveryRoutes(page, {
    appointment: async (route) => {
      await responseReady;
      await route.fulfill({ status: 201, json: receipt() });
    },
  });

  await openConfirm(page);
  await fillGuestDetails(page);
  const confirm = page.getByRole('button', { name: /confirm appointment/i });
  await confirm.evaluate((button) => {
    button.click();
    button.click();
  });

  await expect.poll(() => routes.appointmentPosts.length).toBe(1);

  releaseResponse?.();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();

  expect(routes.unexpected).toEqual([]);
});

test('a lost creation response recovers its receipt without a second POST at 320px', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page, {
    appointment: async route => route.abort('failed'),
    recovery: 'resolved',
  });

  await openConfirm(page);
  await fillGuestDetails(page);
  await page.getByRole('button', { name: /confirm appointment/i }).tap();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible({ timeout: 10_000 });

  expect(routes.appointmentPosts).toHaveLength(1);
  expect(routes.recoveryPosts).toEqual([{ attemptId: expect.any(String), recoveryKey: expect.any(String) }]);
  expect(routes.unexpected).toEqual([]);
});

test('refreshing a pending attempt performs status recovery only at 320px', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page, { recovery: 'unresolved' });
  await seedAttemptBeforeNavigation(page, pendingAttempt());
  await openConfirm(page);

  await page.reload();

  expect(await page.evaluate(key => sessionStorage.getItem(key), ATTEMPT_STORAGE_KEY)).toContain(ATTEMPT_ID);

  await expect(page.getByTestId('booking-recovery-notice')).toBeVisible({ timeout: 10_000 });

  await expect.poll(() => routes.recoveryPosts.length).toBeGreaterThan(0);

  expect(routes.appointmentPosts).toEqual([]);
  expect(routes.recoveryPosts[0]).toEqual({ attemptId: ATTEMPT_ID, recoveryKey: RECOVERY_KEY });
  expect(routes.unexpected).toEqual([]);
});

test('a resolved revisit restores the receipt with no recovery banner or create POST at 320px', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page);
  await seedAttemptBeforeNavigation(page, { ...pendingAttempt(), state: 'resolved', response: receipt() });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/en/${SALON_SLUG}/book/confirm`);

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();

  await expect(page.getByTestId('booking-recovery-notice')).toHaveCount(0);

  expect(routes.appointmentPosts).toEqual([]);
  expect(routes.recoveryPosts).toEqual([]);
  expect(routes.unexpected).toEqual([]);
});

test('uncertainty Check again performs status recovery only at 320px', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page, { recovery: 'unresolved' });
  await seedAttemptBeforeNavigation(page, pendingAttempt());
  await openConfirm(page);

  await page.reload();

  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible({ timeout: 10_000 });

  await expect.poll(() => routes.recoveryPosts.length).toBeGreaterThan(0);

  const before = routes.recoveryPosts.length;

  await page.getByRole('button', { name: 'Check again' }).tap();

  await expect.poll(() => routes.recoveryPosts.length).toBeGreaterThan(before);

  expect(routes.appointmentPosts).toEqual([]);
  expect(routes.unexpected).toEqual([]);
});

test('malformed browser recovery state fails closed without a create POST at 320px', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page);
  await page.addInitScript(key => sessionStorage.setItem(key, '{not json'), ATTEMPT_STORAGE_KEY);
  await openConfirm(page);

  await page.reload();

  await expect(page.getByRole('button', { name: /waiting for booking result/i })).toBeDisabled();

  expect(routes.appointmentPosts).toEqual([]);
  expect(routes.recoveryPosts).toEqual([]);
  expect(routes.unexpected).toEqual([]);
});

test('resolved success stays quiet on service revisit and browser back/forward at 320px', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page);
  await openConfirm(page);
  await fillGuestDetails(page);
  await page.getByRole('button', { name: /confirm appointment/i }).tap();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();

  await page.goto(`/en/${SALON_SLUG}/book/service`);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });

  await expect(page.getByRole('heading', { name: 'Synthetic Booking Test Salon' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Booking status' })).toHaveCount(0);

  await page.goBack();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();

  await page.goForward();

  await expect(page.getByRole('heading', { name: 'Synthetic Booking Test Salon' })).toBeVisible();
  await expect(page.getByTestId('booking-recovery-notice')).toHaveCount(0);

  expect(routes.appointmentPosts).toHaveLength(1);
  expect(routes.unexpected).toEqual([]);
});
