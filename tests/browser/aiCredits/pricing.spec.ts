import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { applySetupOperations, CLOSED_HOURS, type SetupDocument, setupReadiness } from '../../../src/features/business-setup/contracts';
import { resolveBookingConfigFromSettings } from '../../../src/libs/bookingConfig.shared';

test('owner edits starting prices, resumes, reviews wording and resolves a stale range on desktop and phones', async ({ page }, info) => {
  const service = { id: 'gel', name: 'BIAB', description: null, priceCents: 6500, priceDisplayText: 'From $65', durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 10, category: 'builder_gel' as const, bookingCategory: 'manicure' as const, origin: 'existing' as const, confirmed: true };
  const baseline: SetupDocument = { schemaVersion: 1, servicePricingVersion: 1, business: { name: 'Synthetic Pricing Studio', city: 'Toronto', exactAddress: '', homeBased: false, workMode: 'solo', locationDisplayMode: 'city_only' }, hours: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } }, booking: resolveBookingConfigFromSettings(null), services: [service], staff: [], website: { config: {}, content: {} } as SetupDocument['website'] };
  let draft = structuredClone(baseline);
  let revision = 1;
  const requests: any[] = [];
  const head = () => ({ workspace: { status: 'editing' }, revision: { revision, document: draft }, messages: [], uploadReviews: [] });
  await page.route('**/api/admin/business-setup**', async (route) => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    if (body) {
      requests.push(body);
    }
    if (body?.action === 'edit') {
      draft = applySetupOperations(draft, body.edit.operations, 'owner');
      revision++;
    }
    if (body?.action === 'review') {
      return route.fulfill({ json: { data: { revision, hash: `synthetic-pricing-review-${revision}`, changes: [{ path: 'services', before: baseline.services, after: draft.services }], blockers: setupReadiness(draft) } } });
    }
    await route.fulfill({ json: { data: head() } });
  });
  await page.route('**/api/admin/custom-sites**', route => route.fulfill({ json: { head: head(), assets: [], preferences: null, history: [], attempts: [], configured: true, payload: null, rendererOrigin: null } }));
  await page.goto('/?builder=1');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const form = page.locator('form.setup-service').filter({ has: page.getByRole('textbox', { name: 'Service', exact: true }) }).first();
  await form.getByRole('spinbutton', { name: 'Price', exact: true }).fill('75');
  await form.getByRole('button', { name: 'Save service' }).click();

  await expect.poll(() => draft.services[0]?.priceDisplayText).toBe('From $75.00');
  expect(draft.services[0]?.priceCents).toBe(7500);

  await page.reload();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await form.getByText('Price wording', { exact: true }).click();

  await expect(form.getByLabel('Price label (optional)', { exact: true })).toHaveValue('From $75.00');

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const review = page.getByRole('region', { name: 'Review your changes' });

  await expect(review.getByText(/65.00 \(displayed as From \$65\)/)).toBeVisible();
  await expect(review.getByText(/75.00 \(displayed as From \$75.00\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const directory = path.join(process.cwd(), 'artifacts/ai-credits/pricing');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `review-${info.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await form.getByLabel('Price label (optional)', { exact: true }).fill('$75–$95');
  await form.getByRole('button', { name: 'Save service' }).click();

  await expect.poll(() => draft.services[0]?.priceDisplayText).toBe('$75–$95');

  await form.getByRole('spinbutton', { name: 'Price', exact: true }).fill('85');
  await form.getByRole('button', { name: 'Save service' }).click();

  await expect(form.getByRole('alert')).toContainText('Update or clear the old price wording');

  await page.getByRole('button', { name: 'Review', exact: true }).click();

  await expect(review.getByText(/Update or clear the price wording for BIAB/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeDisabled();
  expect(requests.filter(request => ['approve', 'publish'].includes(request.action))).toEqual([]);

  await page.screenshot({ path: path.join(directory, `blocked-${info.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await form.getByText('Price wording', { exact: true }).click();
  await form.getByLabel('Price label (optional)', { exact: true }).fill('From $85.00');
  await form.getByRole('button', { name: 'Save service' }).click();

  await expect.poll(() => draft.services[0]?.priceLabelNeedsReview === true).toBe(false);

  await page.getByRole('button', { name: 'Review', exact: true }).click();

  await expect(review.getByText(/85.00 \(displayed as From \$85.00\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeEnabled();
  expect(requests.filter(request => ['approve', 'publish'].includes(request.action))).toEqual([]);

  await page.screenshot({ path: path.join(directory, `resolved-${info.project.name}.png`), fullPage: true });
});
