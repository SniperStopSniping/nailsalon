import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

const flags = { testOnly: true, nonLegal: true, ordinaryActionsBlocked: true };
function preview(revision: string) {
  return { ...flags, evidenceRevision: revision.repeat(64), original: { serviceCents: 10000, taxCents: 0, tipCents: 2000, totalCents: 12000 }, refunded: { principalCents: 2500, tipCents: 500, totalCents: 3000 }, netTenderCents: 9000, previousCredit: { serviceCreditCents: 0, taxCreditCents: 0, tipCreditCents: 0 }, decision: null, resolution: null };
}
function saved(current = true) {
  return { ...flags, replayed: true, evidenceMatchesCurrent: current, decision: { id: 'synthetic-decision', previousDecisionId: null, serviceCreditCents: 2500, taxCreditCents: 0, tipCreditCents: 500, deltaServiceCreditCents: 2500, deltaTaxCreditCents: 0, deltaTipCreditCents: 500, reason: 'Synthetic reviewed refund', createdAt: '2026-11-08T00:00:00.000Z' } };
}
async function mockTransport(page: Page) {
  const requests: { method: string; path: string; body: string | null }[] = [];
  const external: string[] = [];
  let mode: 'ok' | 'drop' | 'stale' | 'historical' = 'ok';
  let revision = 'a';
  let held: Promise<void> | null = null;
  let release = () => {};
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      external.push(url.href);
      await route.abort();
      return;
    }
    if (!url.pathname.endsWith('/customer-payment-review')) {
      await route.continue();
      return;
    }
    const method = route.request().method();
    requests.push({ method, path: url.pathname, body: route.request().postData() });
    if (method === 'GET') {
      await route.fulfill({ json: preview(revision) });
      return;
    }
    if (held) {
      const wait = held;
      held = null;
      await wait;
    }
    const outcome = mode;
    mode = 'ok';
    if (outcome === 'drop') {
      await route.abort('failed');
    } else if (outcome === 'stale') {
      await route.fulfill({ status: 409, json: { error: { code: 'CREDIT_REVIEW_REQUIRED' } } });
    } else {
      await route.fulfill({ json: saved(outcome !== 'historical') });
    }
  });
  return { requests, external, outcome: (value: typeof mode) => {
    mode = value;
  }, revise: () => {
    revision = 'b';
  }, hold: () => {
    held = new Promise<void>((done) => {
      release = done;
    });
  }, release: () => release(), posts: () => requests.filter(row => row.method === 'POST') };
}
async function open(page: Page) {
  await page.goto('/?view=credit-review');

  await expect(page.getByRole('button', { name: 'Load current test evidence' })).toBeEnabled();
}
async function fillReview(page: Page) {
  await page.getByRole('button', { name: 'Load current test evidence' }).click();
  await page.getByLabel('Service credit', { exact: true }).fill('25.00');
  await page.getByLabel('Tax credit', { exact: true }).fill('0');
  await page.getByLabel('Reason for this test credit note').fill('Synthetic reviewed refund');

  await expect(page.getByRole('button', { name: 'Record test credit note and review' })).toBeDisabled();

  await page.getByRole('checkbox').check();
}

test('explicit non-legal review distinguishes credit and cash, preserves interrupted request identity', async ({ page }) => {
  const mock = await mockTransport(page);
  await open(page);

  expect(mock.requests).toHaveLength(0);

  await fillReview(page);

  await expect(page.getByText('Original invoice total').locator('..')).toContainText('$120.00');
  await expect(page.getByText('Proposed credit-note adjustment').locator('..')).toContainText('$30.00');
  await expect(page.getByText('Retained customer cash').locator('..')).toContainText('$90.00');
  await expect(page.getByText('Successful customer refunds already recorded')).toBeVisible();
  await expect(page.getByText(/This is a non-legal test record/)).toBeVisible();

  const body = page.locator('body');

  await expect(body).toHaveJSProperty('scrollWidth', await body.evaluate(el => el.clientWidth));

  await page.screenshot({ path: `/tmp/luster-credit-review-${test.info().project.name}.png`, fullPage: true });
  mock.outcome('drop');
  await page.getByRole('button', { name: 'Record test credit note and review' }).click();

  await expect(page.getByRole('button', { name: 'Retry same test review' })).toBeEnabled();
  await expect(page.getByLabel('Service credit', { exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Retry same test review' }).click();

  await expect(page.getByText('Test review recorded. Reload current evidence to verify its resolution. No money was returned by this action.')).toBeVisible();
  expect(mock.posts()).toHaveLength(2);
  expect(mock.posts()[1]!.body).toBe(mock.posts()[0]!.body);
  expect(JSON.parse(mock.posts()[0]!.body!)).toMatchObject({ serviceCreditCents: 2500, taxCreditCents: 0, tipCreditCents: 500 });
  expect(mock.external).toEqual([]);
});

test('stale evidence and historical replay both require refreshed review', async ({ page }) => {
  const mock = await mockTransport(page);
  await open(page);
  await fillReview(page);
  mock.outcome('stale');
  await page.getByRole('button', { name: 'Record test credit note and review' }).click();

  await expect(page.getByText(/Evidence changed or is not eligible/)).toBeVisible();
  await expect(page.getByText('Proposed adjusted balance')).toHaveCount(0);

  mock.revise();
  await fillReview(page);
  mock.outcome('historical');
  await page.getByRole('button', { name: 'Record test credit note and review' }).click();

  await expect(page.getByText(/earlier test decision was recorded/)).toBeVisible();
  await expect(page.getByText('Proposed adjusted balance')).toHaveCount(0);

  const first = JSON.parse(mock.posts()[0]!.body!);
  const second = JSON.parse(mock.posts()[1]!.body!);

  expect(second.requestId).not.toBe(first.requestId);
  expect(second.expectedEvidenceRevision).toBe('b'.repeat(64));

  await fillReview(page);
  await page.getByRole('button', { name: 'Close review' }).click();

  await expect(page.getByText('Proposed adjusted balance')).toHaveCount(0);
  expect(mock.external).toEqual([]);
});

test('repeated clicks are suppressed and old appointment response cannot overwrite navigation', async ({ page }) => {
  const mock = await mockTransport(page);
  await open(page);
  await fillReview(page);
  mock.hold();
  await page.getByRole('button', { name: 'Record test credit note and review' }).dblclick();

  await expect.poll(() => mock.posts().length).toBe(1);

  await page.getByRole('button', { name: 'Switch fixture appointment' }).click();

  await expect(page.getByText('Proposed adjusted balance')).toHaveCount(0);

  mock.release();
  await fillReview(page);

  await expect(page.getByText('Test review recorded. Reload current evidence to verify its resolution. No money was returned by this action.')).toHaveCount(0);
  expect(mock.requests.at(-1)!.path).toContain('synthetic-appointment-two');

  await page.getByRole('button', { name: 'Remove review fixture' }).click();

  await expect(page.getByText('Proposed adjusted balance')).toHaveCount(0);
  expect(mock.posts()).toHaveLength(1);
  expect(mock.external).toEqual([]);
});
