import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { SmsCreditsPayload } from '../../../src/hooks/useSmsCredits';

const credits: SmsCreditsPayload = {
  salonId: 'salon_isla',
  canPurchase: true,
  creditPurchasesAvailable: false,
  balance: {
    availableCredits: 18,
    pendingCredits: 0,
    allocationCredits: 100,
    status: 'low',
    totalPurchased: 0,
    usedThisMonth: 82,
    monthStart: '2026-10-01T04:00:00Z',
    timeZone: 'America/Toronto',
    lastPurchaseOfferKey: null,
  },
  topupOffers: [],
  activity: { items: [], nextCursor: null },
};

for (const entry of [
  { button: 'Buy More Texts', view: 'topup', title: 'Buy more texts' },
  { button: 'View usage history', view: 'history', title: 'Text usage history' },
]) {
  for (const dismissal of [
    { name: 'close', run: (page: Page) => page.getByRole('button', { name: 'Close text credits', exact: true }).click() },
    { name: 'Escape', run: (page: Page) => page.keyboard.press('Escape') },
  ]) {
    test(`text credit ${entry.view} shortcut returns directly to More with ${dismissal.name}`, async ({ page, baseURL }, testInfo) => {
      const unexpected: string[] = [];
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== new URL(baseURL!).origin) {
          unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
          await route.abort();
        } else if (url.pathname === '/api/admin/salon/communications/usage' && request.method() === 'GET' && url.searchParams.get('salonSlug') === 'isla') {
          await route.fulfill({ json: { data: credits } });
        } else if (url.pathname === '/api/admin/salon/communications/starter-credits' && request.method() === 'GET' && url.searchParams.get('salonId') === 'salon_isla') {
          await route.fulfill({ json: { data: { status: 'verified', canClaim: false } } });
        } else if (url.pathname.startsWith('/api/')) {
          unexpected.push(`${request.method()} ${url.pathname}`);
          await route.abort();
        } else {
          await route.continue();
        }
      });
      await page.goto('/en/admin?smsCredits=1&salon=isla');

      await expect(page.getByTestId('sms-balance-card')).toContainText('18');

      await page.getByRole('button', { name: entry.button, exact: true }).click();

      await expect(page.getByRole('heading', { name: entry.title, exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`app=plan-usage&view=${entry.view}`));

      await dismissal.run(page);

      await expect(page.getByTestId('more-screen')).toBeVisible();
      expect(new URL(page.url()).searchParams.has('app')).toBe(false);
      expect(new URL(page.url()).searchParams.has('view')).toBe(false);
      expect(new URL(page.url()).searchParams.get('salon')).toBe('isla');
      await expect(page.getByRole('heading', { name: 'Plan & Usage', exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.screenshot({ path: testInfo.outputPath(`sms-${entry.view}-${dismissal.name}-returned.png`), fullPage: true });

      await page.getByRole('button', { name: entry.button, exact: true }).click();

      await expect(page.getByRole('heading', { name: entry.title, exact: true })).toBeVisible();

      await page.goBack();

      await expect(page.getByTestId('more-screen')).toBeVisible();
      expect(unexpected).toEqual([]);
    });
  }
}
