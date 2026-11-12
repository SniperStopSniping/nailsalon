import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { CustomerPaymentDraftResponse, CustomerPaymentDraftWrite } from '../../../src/libs/customerPayments/settings';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../../../src/libs/customerPayments/settings';

// The first request may compile the existing full stylesheet on a cold local Vite server.
test.setTimeout(90_000);

/** In-memory mock transport only. Not evidence of authentication or database writes. */
async function draftTransport(page: Page) {
  let saved: CustomerPaymentDraftResponse = { testOnly: true, collectionEnabled: false, revision: 0, settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } };
  const receipts = new Map<string, CustomerPaymentDraftResponse>();
  const writes: CustomerPaymentDraftWrite[] = [];
  const external: string[] = [];
  let dropNextResponse = false;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      external.push(route.request().url());
      await route.abort();
      return;
    }
    if (url.pathname !== '/api/admin/salon/customer-payments') {
      await route.continue();
      return;
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: saved });
      return;
    }
    const request = route.request().postDataJSON() as CustomerPaymentDraftWrite;
    writes.push(request);
    const replay = receipts.get(request.requestId);
    if (replay) {
      await route.fulfill({ json: replay });
      return;
    }
    if (request.expectedRevision !== saved.revision) {
      await route.fulfill({ status: 409, json: { error: { code: 'CUSTOMER_PAYMENT_DRAFT_REVISION_CONFLICT' } } });
      return;
    }
    saved = { ...saved, revision: saved.revision + 1, settings: request.settings };
    receipts.set(request.requestId, saved);
    if (dropNextResponse) {
      dropNextResponse = false;
      await route.abort('failed');
      return;
    }
    await route.fulfill({ json: saved });
  });
  return {
    writes,
    external,
    read: () => saved,
    loseNextSaveResponse: () => {
      dropNextResponse = true;
    },
    changeInAnotherTab: () => {
      saved = { ...saved, revision: saved.revision + 1, settings: { ...saved.settings, platformFeeCents: 125, cancellationPolicy: 'Updated elsewhere in the mock.' } };
    },
  };
}

async function openDraft(page: Page) {
  await page.goto('/?view=draft');

  await expect(page.getByRole('heading', { name: 'Mock owner draft fixture' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toBeEnabled();
}

test('mock draft loads, saves, and survives reload without external requests', async ({ page }, info) => {
  const mock = await draftTransport(page);
  await openDraft(page);

  await expect(page.getByRole('checkbox')).not.toBeChecked();

  await page.getByRole('checkbox').check();
  await page.getByLabel('Salon-paid Luster fee (CAD cents)').fill('150');
  await page.getByLabel('Draft cancellation and refund wording').fill('Contact the salon about refunds. Mock draft only.');
  await page.getByRole('button', { name: 'Save test draft' }).click();

  await expect(page.getByRole('status')).toContainText('Live collection remains off');
  expect(mock.read().revision).toBe(1);
  expect(mock.read().collectionEnabled).toBe(false);

  await page.reload();

  await expect(page.getByRole('checkbox')).toBeChecked();
  await expect(page.getByLabel('Salon-paid Luster fee (CAD cents)')).toHaveValue('150');
  await expect(page.getByLabel('Draft cancellation and refund wording')).toHaveValue('Contact the salon about refunds. Mock draft only.');
  await expect(page.getByRole('button', { name: 'Save test draft' })).toBeDisabled();

  const body = page.locator('body');

  await expect(body).toHaveJSProperty('scrollWidth', await body.evaluate(el => el.clientWidth));

  await page.screenshot({ path: `/tmp/luster-payment-draft-${info.project.name}.png`, fullPage: true });

  expect(mock.external).toEqual([]);
});

test('mock stale revision requires reload before another edit', async ({ page }) => {
  const mock = await draftTransport(page);
  await openDraft(page);
  mock.changeInAnotherTab();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save test draft' }).click();

  await expect(page.getByRole('alert')).toContainText('Reload it');
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save test draft' })).toBeDisabled();

  await page.getByRole('button', { name: 'Reload saved draft' }).click();

  await expect(page.getByRole('checkbox')).toBeEnabled();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByLabel('Salon-paid Luster fee (CAD cents)')).toHaveValue('125');
  await expect(page.getByLabel('Draft cancellation and refund wording')).toHaveValue('Updated elsewhere in the mock.');
  expect(mock.read().revision).toBe(1);
  expect(mock.external).toEqual([]);
});

test('mock lost save response retries identical request without double update', async ({ page }) => {
  const mock = await draftTransport(page);
  await openDraft(page);
  mock.loseNextSaveResponse();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save test draft' }).click();

  await expect(page.getByRole('alert')).toContainText('Save outcome is not confirmed');
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reload saved draft' })).toBeDisabled();

  await page.getByRole('button', { name: 'Retry same save' }).click();

  await expect(page.getByRole('status')).toContainText('Test draft saved');
  expect(mock.writes).toHaveLength(2);
  expect(mock.writes[1]).toEqual(mock.writes[0]);
  expect(mock.writes[0]!.requestId).toMatch(/^[\da-f-]{36}$/i);
  expect(mock.read().revision).toBe(1);
  expect(mock.external).toEqual([]);
});
