import path from 'node:path';

import { expect, test } from '@playwright/test';

import type { CustomerReviewSnapshot } from '../../../src/libs/customerAssistant/reviewContracts';

const proposal = {
  selection: { baseServiceId: 'gel-x', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] },
  fingerprint: 'f'.repeat(64),
  service: { id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 },
  addOns: [{ id: 'french', name: 'French', quantity: 1, priceCents: 1500 }],
  currency: 'CAD',
  subtotalCents: 10000,
  durationMinutes: 120,
  expiresAt: '2026-09-18T12:05:00Z',
};
const preference = { date: '2026-09-19', earliest: '12:00', latest: '17:00' };
const slot = { time: '13:00', startTime: '2026-09-19T17:00:00Z' };
const timeZone = 'America/Toronto';
const review: CustomerReviewSnapshot = {
  status: 'INCOMPLETE',
  fingerprint: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  salon: { id: 'fixture-salon', name: 'Isla Nail Studio', slug: 'isla-nail-studio' },
  location: { name: 'Isla Nail Studio', address: null, city: 'Toronto', state: 'ON', zipCode: null },
  services: [proposal.service],
  addOns: proposal.addOns,
  technician: { kind: 'any_artist' },
  date: preference.date,
  time: slot.time,
  timeZone,
  durationMinutes: 120,
  financial: { subtotalCents: 10000, estimatedTaxCents: 1300, estimatedTotalCents: 11300, currency: 'CAD' },
  deposit: { status: 'required', amountCents: 2500, currency: 'CAD', label: 'Deposit' },
  confirmationMode: 'request_approval',
  bookingPolicy: { required: true, title: 'Booking policy', text: 'Please arrive on time for your appointment.', acknowledgmentText: 'I agree to the booking policy.', version: 'policy-v1:fixture' },
  blockers: ['reminder_integration', 'identity_pricing'],
};

for (const viewport of [{ width: 390, zoom: 100 }, { width: 320, zoom: 200 }]) {
  test(`synthetic contact and incomplete review at ${viewport.width}px/${viewport.zoom}%`, async ({ page }, testInfo) => {
    const chatBodies: unknown[] = [];
    const reviews: Record<string, unknown>[] = [];
    const unexpected: string[] = [];
    let turn = 0;
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== 'http://127.0.0.1:3130') {
        unexpected.push(url.origin);
        await route.abort();
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
      const token = () => `synthetic-review-${++turn}`;
      if (url.pathname.endsWith('/session')) {
        await route.fulfill({ json: { conversation: token() } });
        return;
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      if (url.pathname.endsWith('/chat')) {
        chatBodies.push(body);
        await route.fulfill({ json: { conversation: token(), result: { kind: 'proposal', proposal } } });
        return;
      }
      if (url.pathname.endsWith('/action')) {
        const result = body.action === 'accept_selection'
          ? { kind: 'date_prompt', proposal, today: '2026-09-18', timeZone }
          : body.action === 'choose_date'
            ? { kind: 'slots', proposal, preference, timeZone, slots: [slot], checkedAt: '2026-09-18T12:00:00Z' }
            : { kind: 'slot_selected', proposal, preference, timeZone, slot };
        await route.fulfill({ json: { conversation: token(), result } });
        return;
      }
      if (url.pathname.endsWith('/review')) {
        reviews.push(body);
        await route.fulfill({ json: { conversation: token(), result: { kind: 'review_prepared', review } } });
        return;
      }
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.abort();
    });
    await page.setViewportSize({ width: viewport.width, height: 844 });
    await page.goto('/');
    await page.addStyleTag({ content: `html { font-size: ${viewport.zoom}%; }` });
    await page.getByRole('button', { name: 'Help me choose & book' }).tap();
    await page.getByLabel('Describe the nails you want').fill('Short Gel-X with French');
    await page.getByRole('button', { name: 'Send' }).tap();
    await page.getByRole('button', { name: 'Choose these services' }).tap();
    await page.getByLabel('Preferred date').fill('2026-09-19');
    await page.getByRole('button', { name: 'Show available times' }).tap();
    await page.getByRole('button', { name: /1:00.*p\.?m\.?/i }).tap();
    await page.getByLabel('Full name').fill('Alex Test');
    await page.getByLabel('Email address').fill('alex@example.test');
    await page.getByLabel('Phone number').fill('4165550100');
    await page.getByRole('button', { name: 'Review booking details' }).tap();

    await expect(page.getByRole('region', { name: 'Your booking details' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Not booked yet' })).toBeVisible();
    await expect(page.getByText('Estimated total', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm booking/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue manually' })).toBeInViewport();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.contact).toEqual({ name: 'Alex Test', email: 'alex@example.test', phone: '4165550100' });
    expect(JSON.stringify(chatBodies)).not.toMatch(/Alex Test|alex@example|4165550100/);
    expect(await page.evaluate(() => `${JSON.stringify(sessionStorage)} ${JSON.stringify(localStorage)}`)).not.toMatch(/Alex Test|alex@example|4165550100/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('heading', { name: 'Your booking details' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.resolve(__dirname, `../../../artifacts/customer-assistant/${testInfo.project.name}-review-${viewport.width}px-${viewport.zoom}zoom.png`), fullPage: true });
    await page.getByText('Estimated total', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.resolve(__dirname, `../../../artifacts/customer-assistant/${testInfo.project.name}-review-price-${viewport.width}px-${viewport.zoom}zoom.png`), fullPage: true });

    await page.getByLabel('Full name').fill('Alex Updated');

    await expect(page.getByRole('region', { name: 'Your booking details' })).toHaveCount(0);
    await expect(page.getByText('Your contact details changed. Review the booking details again.')).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveValue('alex@example.test');
    expect(unexpected).toEqual([]);

    await page.getByRole('button', { name: 'Continue manually' }).tap();

    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('synthetic READY review confirms and shows the durable status on mobile', async ({ page }, testInfo) => {
  const readyReview = {
    ...review,
    status: 'READY',
    financial: { subtotalCents: 10000, discountAmountCents: 0, discountLabel: null, taxAmountCents: 1300, totalDueCents: 11300, currency: 'CAD' },
    reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true },
  };
  const operation = { capability: 'synthetic-opaque-capability', revision: 1, fingerprint: 'b'.repeat(64), expiresAt: readyReview.expiresAt };
  const confirmations: Record<string, unknown>[] = [];
  let turn = 0;
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3130') {
      unexpected.push(url.origin);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    const token = () => `synthetic-durable-${++turn}`;
    const body = request.postDataJSON() as Record<string, unknown>;
    if (url.pathname.endsWith('/session')) {
      await route.fulfill({ json: { conversation: token() } });
    } else if (url.pathname.endsWith('/chat')) {
      await route.fulfill({ json: { conversation: token(), result: { kind: 'slot_selected', proposal, preference, timeZone, slot } } });
    } else if (url.pathname.endsWith('/review')) {
      await route.fulfill({ json: { conversation: token(), result: { kind: 'booking_review', review: readyReview, operation } } });
    } else if (url.pathname.endsWith('/booking/confirm')) {
      confirmations.push(body);

      await route.fulfill({ json: { kind: 'booking_status', operation, status: 'confirmed', review: readyReview, appointment: { id: 'synthetic-appointment', startTime: slot.startTime, durationMinutes: 120, technicianName: null, reminderState: 'enabled' }, payment: null, lastFailure: null } });
    } else {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.abort();
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();
  await page.getByLabel('Describe the nails you want').fill('Gel-X');
  await page.getByRole('button', { name: 'Send' }).tap();
  await page.getByLabel('Full name').fill('Alex Test');
  await page.getByLabel('Email address').fill('alex@example.test');
  await page.getByLabel('Phone number').fill('4165550100');
  await page.getByRole('button', { name: 'Review booking details' }).tap();
  await page.getByLabel('I agree to the booking policy.').tap();
  await page.getByRole('button', { name: 'Confirm booking' }).tap();

  await expect(page.getByText('Your appointment is confirmed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm booking' })).toHaveCount(0);
  await expect(page.getByLabel('Full name')).toHaveCount(0);
  await expect(page.getByLabel('Describe the nails you want')).toBeDisabled();
  expect(confirmations).toContainEqual(expect.objectContaining({ action: 'confirm_booking', capability: operation.capability, revision: 1, fingerprint: operation.fingerprint }));

  await page.screenshot({ path: path.resolve(__dirname, `../../../artifacts/customer-assistant/${testInfo.project.name}-synthetic-durable-confirmed.png`), fullPage: true });

  expect(unexpected).toEqual([]);
});
