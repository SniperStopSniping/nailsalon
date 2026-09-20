import { expect, test } from '@playwright/test';

const longCatalogServiceId = `svc_${'x'.repeat(68)}`;

function checkoutContext() {
  return {
    appointment: {
      id: 'appt_browser_1',
      status: 'confirmed',
      paymentStatus: 'pending',
      clientName: 'Alexandria Verylongname',
      startTime: '2026-09-19T15:00:00.000Z',
      endTime: '2026-09-19T16:00:00.000Z',
      totalDurationMinutes: 60,
      totalPrice: 3500,
      discountAmountCents: null,
      discountLabel: null,
      startedAt: null,
      completedAt: null,
      actualStartAt: null,
      actualEndAt: null,
      finalPriceCents: null,
      finalSubtotalCents: null,
      finalDiscountCents: null,
      finalDiscountReason: null,
      tipCents: 0,
      paymentMethod: null,
      taxEnabledSnapshot: null,
      taxNameSnapshot: null,
      taxRateBps: null,
      taxInclusive: null,
      taxAmountCents: null,
      taxExempt: null,
      taxExemptReason: null,
      bookingTaxSnapshot: null,
      finalTaxSnapshot: null,
    },
    bookedItems: [{ kind: 'service', catalogServiceId: longCatalogServiceId, catalogAddOnId: null, name: 'Russian Manicure with Structured Builder Gel, Detailed Cuticle Care and Long-Wear Chrome Finish', quantity: 1, unitPriceCents: 3500, durationMinutes: 60 }],
    finalItems: [],
    catalog: { services: [{ id: longCatalogServiceId, name: 'Russian Manicure', priceCents: 3500, durationMinutes: 60 }], addOns: [] },
    taxConfig: { enabled: false, name: null, rateBps: 0, pricesIncludeTax: false, taxServicesByDefault: false, taxAddOnsByDefault: false, taxCustomByDefault: false },
    currency: 'CAD',
    timeZone: 'America/Toronto',
    photoPolicy: { requireAfterPhotoToFinish: 'off' },
    photos: [],
    payments: [],
    balance: { totalDueCents: 3500, amountAlreadyPaidCents: 0, balanceCents: 3500 },
    etransfer: { enabled: false, recipient: null, recipientName: null, autodepositEnabled: false, instructions: null, requireReference: false, qrPageEnabled: false },
    paymentReference: 'LSTR-BROWSER',
    permissions: { canEditItems: true, canApplyDiscount: true, canRecordPayment: true, canTaxExempt: true, canMarkComp: true },
  };
}

async function mockFixtureApi(page: import('@playwright/test').Page) {
  const completions: unknown[] = [];
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3146') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (url.pathname.endsWith('/checkout') && request.method() === 'GET') {
      await route.fulfill({ json: { data: checkoutContext() } });
      return;
    }
    if (url.pathname.endsWith('/complete') && request.method() === 'PATCH') {
      completions.push(request.postDataJSON());
      await route.fulfill({ json: { data: { appointment: { id: 'appt_browser_1', status: 'completed', paymentStatus: 'pending', completedAt: '2026-09-19T16:02:00.000Z' }, showReviewPrompt: false } } });
      return;
    }
    if (url.pathname.endsWith('/review-request') && request.method() === 'GET') {
      await route.fulfill({ json: { data: { status: 'disabled', reason: null, canSendManually: false, automationMode: 'manual' } } });
      return;
    }
    if ((url.pathname.endsWith('/messages') || url.pathname.endsWith('/communication')) && request.method() === 'GET') {
      await route.fulfill({ json: { data: { history: [], sms: null } } });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 404, json: { error: 'unexpected synthetic fixture API' } });
      return;
    }
    await route.continue();
  });
  return { completions, unexpected };
}

test('appointment view prioritizes state action, protects dirty edits, and remains readable at narrow and enlarged text', async ({ page }, testInfo) => {
  const { unexpected } = await mockFixtureApi(page);
  await page.goto('/');

  expect(await page.evaluate(() => window.innerWidth)).toBe(page.viewportSize()!.width);

  await page.getByTestId('open-appointment').click();

  const sheet = page.getByTestId('appointment-quick-edit-sheet');

  await expect(sheet).toBeVisible();
  await expect(page.getByText('Save changes', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('appointment-sheet-mark-completed')).toBeInViewport();
  await expect(page.getByText('SMS history', { exact: true })).toBeVisible();
  await expect(page.getByText('SMS history', { exact: true }).locator('..')).not.toHaveAttribute('open');
  await expect(page.getByTestId('appointment-sheet-edit-reschedule')).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath(`appointment-view-${testInfo.project.name}.png`) });

  await expect(page.getByRole('button', { name: 'Communication history Show', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Details Show', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Communication history Show', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Communication history Show' })).toHaveAttribute('aria-expanded', 'false');

  await page.getByTestId('appointment-sheet-edit-reschedule').click();

  await expect(page.getByTestId('appointment-sheet-service-select')).toBeInViewport();

  const start = page.getByTestId('appointment-sheet-start-time');
  await start.fill('2026-09-19T16:15');
  await page.keyboard.press('Escape');

  await expect(sheet).toBeVisible();
  await expect(start).toBeFocused();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.screenshot({ path: testInfo.outputPath(`appointment-sheet-${testInfo.project.name}.png`) });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(unexpected).toEqual([]);
});

test('status-aware footer and checkout review complete a long opaque catalog ID without optional completion fields', async ({ page }, testInfo) => {
  const { completions, unexpected } = await mockFixtureApi(page);
  await page.goto('/');

  expect(await page.evaluate(() => window.innerWidth)).toBe(page.viewportSize()!.width);

  await page.getByTestId('status-pending').click();
  await page.getByTestId('open-appointment').click();

  await expect(page.getByText('Confirm appointment', { exact: true })).toBeVisible();
  await expect(page.getByTestId('appointment-sheet-decline')).toBeVisible();

  await page.getByTestId('appointment-sheet-header-close').click();

  await page.getByTestId('status-in_progress').click();
  await page.getByTestId('open-appointment').click();

  await expect(page.getByTestId('appointment-sheet-mark-completed')).toHaveText('Complete appointment');

  await page.getByTestId('appointment-sheet-mark-completed').click();

  await expect(page.getByTestId('checkout-sheet')).toBeVisible();
  await expect(page.getByTestId('checkout-action-bar')).toBeVisible();
  await expect(page.getByText('Payment method (optional)', { exact: true })).toBeVisible();

  const itemsDetails = page.getByTestId('checkout-items-section');
  await itemsDetails.locator('summary').click();

  await expect(itemsDetails).toHaveAttribute('open', '');
  await expect(itemsDetails.locator('[data-testid^="checkout-item-item_"]')).toBeVisible();

  await itemsDetails.locator('summary').click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.getByTestId('checkout-record-later').click();
  await page.getByTestId('checkout-review-button').click();

  await expect(page.getByTestId('checkout-review')).toBeVisible();
  await expect(page.getByTestId('checkout-complete-button')).toBeInViewport();
  expect((await page.getByTestId('checkout-scroll-region').boundingBox())!.height).toBeGreaterThan(150);
  expect(await page.getByTestId('checkout-sheet').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.screenshot({ path: testInfo.outputPath(`checkout-review-200-${testInfo.project.name}.png`) });

  await page.getByTestId('checkout-complete-button').click();
  await page.getByRole('button', { name: 'Complete without photo' }).click();

  await expect(page.getByTestId('checkout-success')).toBeVisible();
  await expect.poll(() => completions.length).toBe(1);

  const payload = completions[0] as { finalItems: Array<{ catalogServiceId: string }>; payments: unknown[]; actualStartAt?: string; actualEndAt?: string };

  expect(payload.finalItems[0]?.catalogServiceId).toBe(longCatalogServiceId);
  expect(payload.payments).toEqual([]);
  expect(payload.actualEndAt).toBeUndefined();

  await page.screenshot({ path: testInfo.outputPath(`checkout-success-${testInfo.project.name}.png`) });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(unexpected).toEqual([]);
});
