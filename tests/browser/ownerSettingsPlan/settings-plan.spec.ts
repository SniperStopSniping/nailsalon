import { expect, test } from '@playwright/test';

const experience = { primaryColor: null, bookingMessage: 'Welcome', socialLinks: { instagram: null, facebook: null, tiktok: null }, confirmationMessage: 'Thanks', policy: { enabled: false, title: null, text: null, showOnServicePage: true, showBeforeConfirmation: true, showAfterConfirmation: true, showInConfirmationEmail: true, acknowledgment: { required: false, text: null }, version: null }, quickFacts: { appointmentOnly: { enabled: false, label: null }, depositNotice: { enabled: false, label: null }, cancellationNotice: { enabled: false, label: null } } };
async function mockApi(page: import('@playwright/test').Page, lifetime = true) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3141') {
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) {
      return route.continue();
    }
    if (url.pathname === '/api/admin/salon/settings') {
      return route.fulfill({ json: { reviewsEnabled: true, rewardsEnabled: true, billingMode: 'STRIPE', subscriptionStatus: 'active', bookingExperience: experience, bookingConfig: { bufferMinutes: 10, slotIntervalMinutes: 15, currency: 'CAD', timezone: 'America/Toronto', minimumNoticeMinutes: 120, clientChangeCutoffHours: 24, confirmationMode: 'instant' }, payments: { tax: { enabled: false, name: '', ratePercent: 0 }, deposit: { enabled: false } }, communications: {} } });
    }
    if (url.pathname === '/api/admin/profile') {
      return route.fulfill({ json: { user: { name: 'Daniela', email: 'daniela@example.com' } } });
    }
    if (url.pathname === '/api/admin/settings/modules') {
      return route.fulfill({ json: { data: { modules: {}, entitledModules: {}, moduleReasons: {} } } });
    }
    if (url.pathname === '/api/admin/settings/visibility') {
      return route.fulfill({ json: { data: { visibility: { staff: {} }, entitled: false } } });
    }
    if (url.pathname === '/api/admin/settings/booking-flow') {
      return route.fulfill({ json: { data: { bookingFlowCustomizationEnabled: false, bookingFlow: null } } });
    }
    if (url.pathname.startsWith('/api/admin/owner-assistant')) {
      return route.fulfill({ status: 404, json: {} });
    }
    if (url.pathname === '/api/admin/salon/communications/usage') {
      expect(url.searchParams.get('salonSlug')).toBe('salon-a');

      return route.fulfill({ json: { data: {
        salonId: 'salon_1',
        creditPurchasesAvailable: true,
        canPurchase: true,
        topupOffers: [
          { key: 'topup_100', credits: 100, priceCents: 2000, currency: 'CAD', available: true },
          { key: 'topup_200', credits: 200, priceCents: 3000, currency: 'CAD', available: true },
          { key: 'topup_500', credits: 500, priceCents: 5000, currency: 'CAD', available: true },
        ],
        balance: { availableCredits: 138, pendingCredits: 0, allocationCredits: null, status: 'healthy', totalPurchased: 100, usedThisMonth: 62, monthStart: '2026-10-01T04:00:00.000Z', timeZone: 'America/Toronto', lastPurchaseCredits: 100, lastPurchaseOfferKey: 'topup_100' },
        usage: { coreAccess: lifetime ? { status: 'active', monthlySoftwarePriceCents: 0, expiresAt: null, usageBilledSeparately: true } : null, availableCredits: 138, monthlyCredits: 0, starterCredits: 38, purchasedCredits: 100, bonusCredits: 0, monthlyAllowance: 0, resetsAt: null, blockedMessages: 0, pendingCredits: 0, plan: null },
        history: [],
        nextCursor: null,
      } } });
    }
    if (url.pathname === '/api/admin/salon/communications/starter-credits') {
      return route.fulfill({ json: { data: { status: 'verified', canClaim: false } } });
    }
    if (url.pathname === '/api/billing/topups') {
      return route.fulfill({ json: { available: true, items: [], nextCursor: null } });
    }
    if (url.pathname === '/api/billing/portal' || url.pathname.includes('/checkout')) {
      throw new Error('browser harness must never open a payment provider');
    }
    return route.fulfill({ json: {} });
  });
}

test('mobile Settings exposes only secondary destinations and guards a dirty Account exit', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?salon=salon-a&app=settings');
  for (const item of ['Account', 'Owner & Staff Alerts', 'Appointment Photo Rules', 'Advanced']) {
    await expect(page.getByText(item, { exact: true })).toBeVisible();
  }

  await expect(page.getByText('Business', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Booking & Availability', { exact: true })).toHaveCount(0);

  await page.getByText('Advanced', { exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Advanced', exact: true })).toBeVisible();
  await expect(page.getByText('Optional Features', { exact: true })).toBeVisible();

  await page.getByText('Optional Features', { exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Optional Features', exact: true })).toBeVisible();

  await page.goBack();

  await expect(page.getByRole('heading', { name: 'Advanced', exact: true })).toBeVisible();

  await page.goBack();

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await page.getByText('Account', { exact: true }).click();

  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue('daniela@example.com');

  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Daniela D');
  await page.getByRole('button', { name: 'Open Plan & Usage' }).click();

  await expect(page.getByRole('alertdialog')).toContainText('unsaved changes');

  await page.getByRole('button', { name: 'Keep editing' }).click();

  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile Plan & Usage hosts billing presentation without opening the portal', async ({ page }, testInfo) => {
  await mockApi(page);
  await page.goto('/?salon=salon-a&app=plan-usage');

  await expect(page.getByRole('button', { name: /compare plans/i })).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath('plan-usage-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: /plan & billing/i }).click();

  await expect(page).toHaveURL(/app=plan-usage&view=billing/);
  await expect(page.getByText('Stripe Billing')).toBeVisible();
  await expect(page.getByTestId('manage-billing-button')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan & Usage' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plans', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Usage & billing', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Usage & billing', exact: true })).toBeVisible();
  await expect(page.getByText('138 SMS credits remaining')).toBeVisible();
  await expect(page.getByText('Founding Salon · Free for life')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const lifetime of [true, false]) {
  test(`saved plans link shows accurate access and current text prices (lifetime: ${lifetime})`, async ({ page }, testInfo) => {
    await mockApi(page, lifetime);
    await page.goto('/?salon=salon-a&app=plan-usage&view=plans');

    await expect(page.getByRole('dialog', { name: 'Usage & billing', exact: true })).toBeVisible();
    await expect(page.getByText('138 SMS credits remaining')).toBeVisible();
    await expect(page.getByText('Founding Salon · Free for life')).toHaveCount(lifetime ? 1 : 0);

    for (const label of ['100 credits — $20.00', '200 credits — $30.00', '500 credits — $50.00']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
    }

    await expect(page.getByText(/14\.99|24\.99|44\.99|Compare plans/)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.screenshot({ path: testInfo.outputPath('credits-overview-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close usage and billing', exact: true }).click();

    await expect(page).toHaveURL(/salon=salon-a&app=plan-usage$/);
    await expect(page.getByRole('button', { name: /messages & credits/i })).toBeVisible();
  });
}

test('direct top-up shortcut retains one-time CAD packages and selected salon', async ({ page }, testInfo) => {
  await mockApi(page);
  await page.goto('/?salon=salon-a&app=plan-usage&view=topup');

  const dialog = page.getByRole('dialog', { name: 'Buy more texts', exact: true });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('One-time purchase. No subscription required.')).toBeVisible();

  for (const [credits, price] of [[100, 20], [200, 30], [500, 50]]) {
    const offer = dialog.getByRole('button', { name: `Buy ${credits} texts`, exact: true });

    await expect(offer).toBeEnabled();
    await expect(offer).toContainText(`$${price}CAD`);
  }

  await expect(dialog.getByText('Your last purchase')).toBeVisible();
  await expect(dialog.getByText('Best Value')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: testInfo.outputPath('topups-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close text credits', exact: true }).click();

  await expect(page).toHaveURL(/salon=salon-a$/);
});
