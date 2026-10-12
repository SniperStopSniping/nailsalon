import { expect, test } from '@playwright/test';

for (const { stale, label } of [{ stale: false, label: 'current readiness' }, { stale: true, label: 'unconfirmed fallback' }]) {
  test(`payment status refresh shows ${label}`, async ({ page, baseURL }, testInfo) => {
    const unexpected: string[] = [];
    const refreshBodies: unknown[] = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== new URL(baseURL!).origin) {
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
        await route.abort();
      } else if (url.pathname === '/api/integrations/health' && request.method() === 'GET' && url.searchParams.get('salonSlug') === 'isla') {
        await route.fulfill({ json: { data: { stripeConnect: {
          salonId: 'salon_isla',
          visible: true,
          status: 'restricted',
          chargeReady: false,
          payoutsPending: false,
          hasBindingHistory: true,
          requirements: { pastDue: ['business_profile.url'], currentlyDue: [] },
          lastSyncedAt: '2026-09-28T12:00:00.000Z',
        } } } });
      } else if (url.pathname === '/api/integrations/stripe-connect/refresh-status' && request.method() === 'POST') {
        refreshBodies.push(request.postDataJSON());
        await route.fulfill({ json: {
          status: stale ? 'restricted' : 'charge_ready',
          chargeReady: !stale,
          payoutsPending: stale ? null : false,
          requirements: null,
          lastSyncedAt: stale ? '2026-09-28T12:00:00.000Z' : '2026-10-12T18:00:00.000Z',
          stale,
        } });
      } else if (url.pathname.startsWith('/api/')) {
        unexpected.push(`${request.method()} ${url.pathname}`);
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.goto('/en/admin?salon=isla&app=payments&view=stripe');

    await expect(page.getByText('Action required', { exact: true })).toBeVisible();
    await expect(page.getByText(/Last checked/)).toBeVisible();
    expect(refreshBodies).toEqual([]);

    const refresh = page.getByRole('button', { name: 'Check status again', exact: true });
    const bounds = await refresh.boundingBox();

    expect(bounds?.height).toBeGreaterThanOrEqual(44);

    await refresh.click();

    await expect(page.getByRole(stale ? 'alert' : 'status')).toContainText(stale ? 'Showing the last saved status.' : 'Payment status is up to date.');
    await expect(page.getByText(stale ? 'Action required' : 'Ready for deposits', { exact: true })).toBeVisible();
    await expect(refresh).toBeEnabled();
    expect(refreshBodies).toEqual([{ salonId: 'salon_isla' }]);
    expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.screenshot({ path: testInfo.outputPath(`stripe-status-${stale ? 'unconfirmed' : 'ready'}.png`), fullPage: true });
  });
}
