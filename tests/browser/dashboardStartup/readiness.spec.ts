import { expect, test } from '@playwright/test';

import { addDaysToDateKey, getDateKeyInTimeZone, zonedTimeToUtc } from '../../../src/libs/timeZone';

const timeZone = 'America/Toronto';

for (const outcome of ['enabled', 'disabled', 'failed'] as const) {
  test(`Today loads while modules are pending and remains usable when ${outcome}`, async ({ page }, testInfo) => {
    const date = getDateKeyInTimeZone(new Date(), timeZone);
    const tomorrowDate = addDaysToDateKey(date, 1);
    const tomorrowAppointment = {
      id: 'appt-readiness-tomorrow',
      clientName: 'Emma Robinson',
      startTime: zonedTimeToUtc({ date: tomorrowDate, time: '10:00', timeZone }).toISOString(),
      endTime: zonedTimeToUtc({ date: tomorrowDate, time: '11:00', timeZone }).toISOString(),
      status: 'confirmed',
      totalDurationMinutes: 60,
      services: ['Russian Manicure'],
    };
    let releaseAuth!: () => void;
    const authPending = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
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
          await authPending;
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
          body = { data: { appointments: [], schedule: { timeZone, businessHours: {}, technicians: [], timeOff: [], blockedSlots: [] } } };
          break;
        case '/api/admin/fraud-signals':
          body = { data: { signals: [], unresolvedCount: 0 } };
          break;
        case '/api/admin/today':
          body = {
            data: {
              date,
              timeZone,
              appointments: [],
              tomorrow: { date: tomorrowDate, appointments: [tomorrowAppointment] },
              dueClients: [],
              failedConfirmations: [],
              googleEventsNeedingReview: 0,
              integrationHealth: { google: { readiness: 'ready', status: 'connected' }, calendarOutbox: { pending: 0, failed: 0 } },
            },
          };
          break;
        case '/api/appointments/appt-readiness-tomorrow/manage':
          if (url.searchParams.get('salonSlug') !== 'readiness-studio') {
            throw new Error('The appointment details request must keep the selected salon.');
          }
          body = {
            data: {
              appointment: { ...tomorrowAppointment, salonSlug: 'readiness-studio', timeZone, clientPhone: '4165550100', baseServiceName: 'Russian Manicure' },
              services: [{ name: 'Russian Manicure' }],
              serviceOptions: [],
              technicianOptions: [],
              addOns: [],
              communications: [],
              permissions: {},
            },
          };
          break;
        case '/api/admin/appointments/appt-readiness-tomorrow/deposit':
          body = { data: { deposits: [], auditRows: [] } };
          break;
        case '/api/appointments/appt-readiness-tomorrow/communication':
          if (route.request().method() !== 'GET') {
            throw new Error('The readiness fixture only permits reading communication history.');
          }
          body = { data: { reminderDue: false, history: [] } };
          break;
        case '/api/appointments/appt-readiness-tomorrow/review-request':
          if (route.request().method() !== 'GET') {
            throw new Error('The readiness fixture only permits reading review request status.');
          }
          body = { data: { status: 'ineligible', reason: 'The appointment is upcoming.', canSendManually: false } };
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
        case '/api/admin/salon/communications/starter-credits':
          if (route.request().method() !== 'GET' || url.searchParams.get('salonId') !== 'synthetic-salon') {
            throw new Error('The readiness fixture only permits the active salon allowance read.');
          }
          body = { data: { status: 'verified', canClaim: false } };
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

      const loading = page.getByTestId('admin-auth-loading');

      await expect(loading).toHaveText('LusterOpening your studio…');
      await expect(page.getByRole('heading', { name: 'Quick actions' })).toHaveCount(0);

      const initialViewport = page.viewportSize()!;
      for (const viewport of [initialViewport, { ...initialViewport, height: initialViewport.height + 100 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);

        // The painted loading surface, its wrapper, and the page must all fit
        // the visible screen without a spare strip or a scrollable blank area.
        await expect.poll(() => loading.evaluate((element) => {
          const surface = element.firstElementChild!.getBoundingClientRect();
          const wrapper = element.getBoundingClientRect();
          return {
            top: surface.top,
            bottom: surface.bottom,
            wrapperBottom: wrapper.bottom,
            pageHeight: document.documentElement.scrollHeight,
            pageWidth: document.documentElement.scrollWidth,
            viewportHeight: innerHeight,
            viewportWidth: innerWidth,
          };
        })).toEqual({
          top: 0,
          bottom: viewport.height,
          wrapperBottom: viewport.height,
          pageHeight: viewport.height,
          pageWidth: viewport.width,
          viewportHeight: viewport.height,
          viewportWidth: viewport.width,
        });
      }
      await page.setViewportSize(initialViewport);
      await page.screenshot({ scale: 'css', path: testInfo.outputPath('opening-studio.png') });
      releaseAuth();

      await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible();
      await expect(loading).toHaveCount(0);
      await expect(page.getByText('No appointments today', { exact: true })).toBeVisible();
      expect(requests).toContain('/api/admin/settings/modules');
      expect(requests).toContain('/api/admin/today');
      expect(requests).toContain('/api/admin/financial-summary');
      expect(requests).not.toContain('/api/admin/analytics');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.screenshot({ scale: 'css', path: testInfo.outputPath('today-while-modules-pending.png') });
      await page.getByRole('tab', { name: 'More', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Text Message Balance' })).toBeVisible();
      await expect.poll(() => requests.includes('/api/admin/salon/communications/starter-credits')).toBe(true);
      await expect(page.getByRole('button', { name: /^Analytics/ })).toHaveCount(0);

      const moduleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/settings/modules');
      release();
      await moduleResponse;

      await expect(page.getByRole('button', { name: /^Analytics/ })).toHaveCount(outcome === 'failed' ? 0 : 1);

      await page.getByRole('tab', { name: 'Today', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible();

      const agenda = page.getByTestId('owner-today-agenda');
      await agenda.getByRole('tab', { name: 'Tomorrow (1)' }).click();
      await agenda.getByRole('button', { name: /10:00 AM Emma R\. Russian Manicure · 60 min/ }).click();

      const sheet = page.getByTestId('appointment-quick-edit-sheet');

      await expect(sheet.getByText('Emma Robinson', { exact: true })).toBeVisible();
      expect(requests).toContain('/api/appointments/appt-readiness-tomorrow/manage');

      expect(errors).toEqual([]);
    } finally {
      releaseAuth();
      release();
    }
  });
}
