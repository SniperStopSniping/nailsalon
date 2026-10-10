import { expect, type Page, test } from '@playwright/test';

function usagePayload() {
  return {
    data: {
      salonId: 'salon_fixture',
      creditPurchasesAvailable: false,
      topupOffers: [],
      usage: {
        availableCredits: 110,
        monthlyCredits: 0,
        starterCredits: 10,
        purchasedCredits: 0,
        bonusCredits: 100,
        monthlyAllowance: 0,
        resetsAt: null,
        blockedMessages: 0,
        plan: null,
      },
      history: [],
      nextCursor: null,
    },
  };
}

async function mockUsageBilling(page: Page, status: 'verified' | 'unclaimed', canClaim: boolean, requests: string[]) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3127') {
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    requests.push(`${request.method()} ${url.pathname}`);
    if (request.method() !== 'GET') {
      await route.fulfill({ status: 405, json: { error: 'Unexpected mutation' } });
      return;
    }
    if (url.pathname === '/api/admin/salon/communications/usage') {
      await route.fulfill({ json: usagePayload() });
      return;
    }
    if (url.pathname === '/api/billing/topups') {
      await route.fulfill({ json: { available: false, items: [], nextCursor: null } });
      return;
    }
    if (url.pathname === '/api/admin/salon/communications/starter-credits') {
      await route.fulfill({ json: { data: { status, canClaim } } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: 'Unknown fixture API' } });
  });
}

test('a verified allowance stays verified after mobile reload and never posts another claim', async ({ page }) => {
  const requests: string[] = [];
  await mockUsageBilling(page, 'verified', false, requests);

  await page.goto('/?fixture=usage-billing');

  await expect(page.getByText('Free-text allowance already claimed. Verification does not add another 100 credits.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Claim 100 free texts|Verify free-text allowance/ })).toHaveCount(0);

  await page.reload();

  await expect(page.getByText('Free-text allowance already claimed. Verification does not add another 100 credits.')).toBeVisible();
  expect(requests.filter(request => request.startsWith('POST'))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a collaborator sees the owner-only status without a claim action', async ({ page }) => {
  const requests: string[] = [];
  await mockUsageBilling(page, 'unclaimed', false, requests);

  await page.goto('/?fixture=usage-billing');

  await expect(page.getByText('Only the salon owner can verify the free-text allowance. Sign in with the owner account.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Claim 100 free texts|Verify free-text allowance/ })).toHaveCount(0);
  expect(requests.filter(request => request.startsWith('POST'))).toEqual([]);
});
