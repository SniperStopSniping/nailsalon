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
  recovery?: 'resolved' | 'unresolved' | 'resolved_failure';
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
        : { kind: options.recovery === 'resolved_failure' ? 'resolved_failure' : 'unresolved' } });
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

test('existing appointment choices preserve privacy and keyboard focus at 320px and 200 percent text', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page);
  await openConfirm(page);
  await fillGuestDetails(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const options = page.getByRole('complementary', { name: 'Existing appointment options' });

  await expect(options.getByRole('link', { name: 'View my appointments' })).toHaveAttribute('href', `/en/${SALON_SLUG}/find-booking`);
  await expect(options.getByRole('button', { name: /cancel/i })).toHaveCount(0);
  expect(routes.appointmentPosts).toHaveLength(0);
  expect(routes.recoveryPosts).toHaveLength(0);

  await options.getByRole('button', { name: 'Book another appointment' }).focus();
  await page.keyboard.press('Enter');

  await expect(options).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Review your appointment' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(routes.appointmentPosts).toHaveLength(0);

  await page.getByRole('button', { name: /confirm appointment/i }).click();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();
  expect(routes.appointmentPosts).toHaveLength(1);
});

test('manage existing opens secure recovery without submitting another appointment', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page);
  await openConfirm(page);
  await page.getByRole('link', { name: 'View my appointments' }).click();

  await expect(page.getByRole('heading', { name: 'Find my booking' })).toBeVisible();
  expect(routes.appointmentPosts).toHaveLength(0);
  expect(routes.recoveryPosts).toHaveLength(0);
});

test('a deliberate new booking clears only the resolved receipt and accepts a new submission', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page);
  await openConfirm(page);
  await fillGuestDetails(page);
  await page.getByRole('button', { name: /confirm appointment/i }).click();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();

  await page.getByRole('button', { name: 'Start another booking' }).click();

  expect(await page.evaluate(key => sessionStorage.getItem(key), ATTEMPT_STORAGE_KEY)).toBeNull();

  await openConfirm(page);
  await fillGuestDetails(page);
  await page.getByRole('button', { name: /confirm appointment/i }).click();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();
  expect(routes.appointmentPosts).toHaveLength(2);
  expect(routes.recoveryPosts).toHaveLength(0);
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
  expect(routes.recoveryPosts).toEqual([{ attemptId: expect.any(String), recoveryKey: expect.any(String), version: 2, startedAt: expect.any(String) }]);
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

  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible({ timeout: 25_000 });

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

test('server-proven stale failure releases confirmation and permits exactly one deliberate new booking', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page, { recovery: 'resolved_failure' });
  await seedAttemptBeforeNavigation(page, { ...pendingAttempt(), version: 2, startedAt: '2030-01-01T00:00:00.000Z' });
  await openConfirm(page);

  await expect(page.getByText(/That booking attempt did not complete/)).toBeVisible();
  await expect(page.getByTestId('booking-recovery-notice')).toHaveCount(0);
  expect(routes.appointmentPosts).toEqual([]);
  expect(await page.evaluate(key => sessionStorage.getItem(key), ATTEMPT_STORAGE_KEY)).toBeNull();

  await fillGuestDetails(page);
  await page.getByRole('button', { name: /confirm appointment/i }).tap();

  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();
  expect(routes.appointmentPosts).toHaveLength(1);
  expect(routes.unexpected).toEqual([]);
});

test('uncertainty remains coherent at 320px and 200 percent text through refresh', async ({ page }) => {
  const routes = await installSyntheticRecoveryRoutes(page, { recovery: 'unresolved' });
  await seedAttemptBeforeNavigation(page, pendingAttempt());
  await openConfirm(page);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });

  await expect(page.getByTestId('booking-recovery-notice')).toBeVisible();
  await expect(page.getByText(/Not booked yet|Nothing is booked yet/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Find my booking' })).toBeVisible();
  expect(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).map(el => ({ tag: el.tagName, text: el.textContent?.slice(0, 80), className: el.className })))).toEqual([]);

  await page.reload();

  await expect(page.getByTestId('booking-recovery-notice')).toBeVisible();
  await expect(page.getByText(/Not booked yet|Nothing is booked yet/)).toHaveCount(0);
  expect(routes.appointmentPosts).toEqual([]);
});

for (const channel of ['email', 'phone'] as const) {
  test(`find booking uses ${channel} alone at 320px and 200 percent text`, async ({ page }) => {
    const requests: unknown[] = [];
    await page.route('**/api/public/appointments/recovery', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 202, json: { data: { accepted: true } } });
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/en/${SALON_SLUG}/find-booking`);
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await page.getByLabel(channel === 'email' ? 'Booking email' : 'Mobile phone').fill(channel === 'email' ? 'synthetic@example.test' : '4165550101');
    const submit = page.getByRole('button', { name: channel === 'email' ? 'Email my booking link' : 'Text my booking link' });

    await expect(submit).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await submit.tap();

    await expect(page.getByText('Request received')).toBeVisible();
    expect(requests).toEqual([{ salonSlug: SALON_SLUG, [channel]: channel === 'email' ? 'synthetic@example.test' : '4165550101' }]);
  });
}
