import { expect, test } from '@playwright/test';

for (const outcome of ['enabled', 'disabled', 'failed'] as const) {
  test(`Today loads while modules are pending and remains usable when ${outcome}`, async ({ page }, testInfo) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:3171') {
        throw new Error('External calls are forbidden in the readiness fixture.');
      }
      if (!url.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
      requests.push(url.pathname);
      let body: unknown;
      let status = 200;
      switch (url.pathname) {
        case '/api/admin/auth/me':
          body = { user: { id: 'synthetic-owner', name: 'Test owner', isSuperAdmin: false, salons: [{ id: 'synthetic-salon', slug: 'readiness-studio', name: 'Readiness Studio', role: 'owner', status: 'active' }] } };
          break;
        case '/api/admin/auth/set-active-salon':
          body = { ok: true };
          break;
        case '/api/admin/settings/modules':
          await pending;
          status = outcome === 'failed' ? 503 : 200;
          body = { data: { moduleReasons: { analyticsDashboard: outcome === 'enabled' ? 'ENABLED' : 'MODULE_DISABLED' } } };
          break;
        case '/api/admin/appointments':
          body = { data: { appointments: [], schedule: { technicians: [] } } };
          break;
        case '/api/admin/fraud-signals':
          body = { data: { signals: [], unresolvedCount: 0 } };
          break;
        case '/api/admin/today':
          body = { data: { date: '2026-10-10', timeZone: 'America/Toronto', appointments: [], dueClients: [], failedConfirmations: [], googleEventsNeedingReview: 0, integrationHealth: { google: { readiness: 'ready', status: 'connected' }, calendarOutbox: { pending: 0, failed: 0 } } } };
          break;
        case '/api/admin/retention':
          body = { data: { retention: [], appointmentReminders: [], history: [] } };
          break;
        case '/api/admin/financial-summary':
          status = 403;
          body = { error: { code: 'OWNER_REQUIRED', message: 'Revenue is available to the owner.' } };
          break;
        case '/api/admin/salon/communications/usage':
          body = { smsCredits: 143 };
          break;
        case '/api/admin/owner-assistant/context':
          status = 404;
          body = { error: { code: 'NOT_AVAILABLE' } };
          break;
        default:
          throw new Error(`Unexpected readiness request: ${url.pathname}`);
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    try {
      await page.goto('/readiness.html?salon=readiness-studio');

      await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible();
      await expect(page.getByText('No appointments today', { exact: true })).toBeVisible();
      expect(requests).toContain('/api/admin/settings/modules');
      expect(requests).toContain('/api/admin/today');
      expect(requests).toContain('/api/admin/financial-summary');
      expect(requests).not.toContain('/api/admin/analytics');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.screenshot({ scale: 'css', path: testInfo.outputPath('today-while-modules-pending.png') });
      await page.getByRole('tab', { name: 'More', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Text Message Balance' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Analytics/ })).toHaveCount(0);

      const moduleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/settings/modules');
      release();
      await moduleResponse;

      await expect(page.getByRole('button', { name: /^Analytics/ })).toHaveCount(outcome === 'failed' ? 0 : 1);

      await page.getByRole('tab', { name: 'Today', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });
}
