import { expect, test } from '@playwright/test';

test('More has exactly one first usage row and reuses the mobile top-up screen', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/starter-credits')) {
      await route.fulfill({ json: { data: { status: 'verified', canClaim: false } } });
      return;
    }
    await route.fulfill({ json: { data: {
      salonId: 'salon_fixture',
      creditPurchasesAvailable: true,
      canPurchaseCredits: true,
      topupOffers: [{ key: 'topup_100_2026_10', credits: 100, priceCents: 2000 }, { key: 'topup_200_2026_10', credits: 200, priceCents: 3000 }, { key: 'topup_500_2026_10', credits: 500, priceCents: 5000 }],
      usage: { availableCredits: 8, starterCredits: 0, blockedMessages: 0, plan: null },
      history: [{ id: 'sms_1', channel: 'sms', eventType: 'review_request', status: 'delivered', creditsUsed: 1, recipient: '•••• 1234', sentAt: '2026-10-03T12:00:00Z', scheduledFor: '2026-10-03T12:00:00Z', failureReason: null }],
      nextCursor: null,
    } } });
  });
  await page.goto('/?fixture=more-usage');
  const row = page.getByTestId('admin-app-tile-plan-usage');

  await expect(row).toHaveCount(1);
  await expect(row).toHaveText(/Usage & Top Ups.*8 texts remaining · Top up now/);

  const headings = await page.getByRole('heading').allTextContents();

  expect(headings.slice(0, 2)).toEqual(['Usage', 'Booking']);

  await row.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('8 texts remaining', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /100 texts — \$20/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /200 texts — \$30/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /500 texts — \$50/ })).toBeVisible();
  await expect(page.getByText('Review request', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: `/tmp/luster-usage-topups-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close usage and top ups' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
});
