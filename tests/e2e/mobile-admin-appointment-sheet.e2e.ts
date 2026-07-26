import { devices, expect, test } from '@playwright/test';

import {
  cancelAppointmentAsAdmin,
  createImpersonatedAdminRequestContext,
  ensureCalendarDayVisible,
  getStaffTechnicianProfile,
  openAdminAppointmentSheet,
  openAdminBookings,
} from './support/appointment-ops';
import { authenticateCustomer } from './support/auth';
import { createAppointmentViaApi } from './support/booking';
import {
  appPath,
  authStatePaths,
  e2eConfig,
  uniqueCustomerPhone,
} from './support/config';

test.use({ storageState: authStatePaths.superAdmin });

async function cancelCreatedAppointment(appointmentId: string | null) {
  if (appointmentId) {
    await cancelAppointmentAsAdmin(appointmentId);
  }
}

test('iPhone Safari navigates an unselected week to an explicit future date @mobile-safari', async ({ page }) => {
  await page.setContent(`
    <button type="button" aria-label="Next week">Next week</button>
    <button type="button" aria-label="Previous week">Previous week</button>
    <output data-testid="calendar-next-count">0</output>
    <div data-testid="calendar-days"></div>
  `);

  await page.evaluate(() => {
    const days = document.querySelector('[data-testid="calendar-days"]');
    const next = document.querySelector('[aria-label="Next week"]');
    const count = document.querySelector('[data-testid="calendar-next-count"]');
    const render = (startDay: number) => {
      if (!days) {
        return;
      }
      days.innerHTML = Array.from({ length: 7 }, (_, offset) => {
        const day = String(startDay + offset).padStart(2, '0');
        return `<button type="button" data-testid="calendar-day-2026-08-${day}" data-selected="false">${day}</button>`;
      }).join('');
    };
    render(2);
    next?.addEventListener('click', () => {
      render(9);
      if (count) {
        count.textContent = '1';
      }
    });
  });

  await ensureCalendarDayVisible(page, '2026-08-10');

  await expect(page.getByTestId('calendar-day-2026-08-10')).toBeVisible();
  await expect(page.getByTestId('calendar-next-count')).toHaveText('1');
});

test('iPhone Safari keeps upcoming appointment actions and edit controls reachable @mobile-safari', async ({
  browser,
  page,
  baseURL,
}) => {
  test.slow();

  expect(page.viewportSize()).toEqual(devices['iPhone 13'].viewport);

  const staffTechnician = await getStaffTechnicianProfile();
  const adminRequest = await createImpersonatedAdminRequestContext();
  const phone = uniqueCustomerPhone();
  let appointmentId: string | null = null;

  try {
    const locationResponse = await adminRequest.get(
      `/api/admin/location?salonSlug=${encodeURIComponent(e2eConfig.salonSlug)}`,
    );
    const locationBody = await locationResponse.json().catch(() => null) as {
      data?: {
        location?: {
          id?: string;
          address?: string | null;
        };
      };
    } | null;
    const location = locationBody?.data?.location;

    expect(locationResponse.ok(), JSON.stringify(locationBody)).toBe(true);
    expect(location?.id, 'The E2E salon needs a primary location.').toBeTruthy();
    expect(location?.address, 'The primary location needs an address for Directions.').toBeTruthy();

    const customerContext = await browser.newContext({ baseURL });
    const customerPage = await customerContext.newPage();

    try {
      await authenticateCustomer(customerPage, phone);
      const appointment = await createAppointmentViaApi(customerPage, {
        technicianId: staffTechnician.id,
        clientName: `Mobile Sheet ${phone.slice(-4)}`,
        clientPhone: phone,
        clientEmail: `mobile-sheet+${phone}@example.com`,
        locationId: location!.id,
      });
      appointmentId = appointment.id;

      const reminderRequests: string[] = [];
      page.on('request', (request) => {
        if (
          request.method() === 'POST'
          && request.url().includes(`/api/appointments/${appointment.id}/send-reminder`)
        ) {
          reminderRequests.push(request.url());
        }
      });

      await openAdminBookings(page);
      await openAdminAppointmentSheet(page, appointment.id, appointment.dateString);

      const sheet = page.getByTestId('appointment-quick-edit-sheet');
      const actions = sheet.getByTestId('upcoming-appointment-actions');
      const scrollRegion = sheet.getByTestId('appointment-sheet-scroll-region');
      const close = sheet.getByTestId('appointment-sheet-close');

      await expect(actions).toBeVisible();
      await expect(actions.getByRole('button', { name: 'Call', exact: true })).toBeVisible();
      await expect(actions.getByRole('button', { name: 'Text', exact: true })).toBeVisible();
      await expect(actions.getByRole('button', { name: /^(?:Send|Resend) reminder$/ })).toBeVisible();
      await expect(actions.getByRole('button', { name: 'Send details', exact: true })).toBeVisible();
      await expect(actions.getByRole('button', { name: 'Directions', exact: true })).toBeVisible();
      await expect(actions.getByRole('button', { name: 'Change appointment', exact: true })).toBeVisible();
      await expect(actions.getByRole('button', { name: 'Cancel appointment', exact: true })).toBeVisible();
      await expect(sheet.getByText('Email client', { exact: true })).toHaveCount(0);

      await expect(scrollRegion).toBeVisible();
      await expect.poll(async () => scrollRegion.evaluate(element => (
        element.scrollHeight > element.clientHeight
      ))).toBe(true);

      const closeBeforeScroll = await close.boundingBox();

      expect(closeBeforeScroll).not.toBeNull();

      await actions.getByRole('button', { name: 'Change appointment', exact: true }).click();

      await expect.poll(async () => scrollRegion.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await expect(sheet.getByText('Edit booking details', { exact: true })).toBeInViewport();
      await expect(close).toBeInViewport();

      const closeAfterScroll = await close.boundingBox();

      expect(closeAfterScroll).not.toBeNull();
      expect(Math.abs(closeAfterScroll!.y - closeBeforeScroll!.y)).toBeLessThanOrEqual(2);
      expect(reminderRequests).toEqual([]);

      await close.click();

      await expect(sheet).toBeHidden();
    } finally {
      await customerContext.close();
    }
  } finally {
    await adminRequest.dispose();
    await cancelCreatedAppointment(appointmentId);
  }
});

test('iPhone Safari keeps archive confirmation safe and refreshes after success @mobile-safari', async ({
  page,
}) => {
  test.slow();

  expect(page.viewportSize()).toEqual(devices['iPhone 13'].viewport);

  const organizationsResponse = await page.request.get(
    `/api/super-admin/organizations?page=1&pageSize=20&q=${encodeURIComponent(e2eConfig.salonSlug)}`,
  );
  const organizations = await organizationsResponse.json();
  const salon = organizations.items?.find(
    (item: { slug?: string }) => item.slug === e2eConfig.salonSlug,
  );

  expect(salon?.id, 'The configured E2E salon must exist.').toBeTruthy();

  const impersonation = await page.request.post(
    '/api/super-admin/impersonate',
    { data: { salonId: salon.id } },
  );

  expect(impersonation.ok(), await impersonation.text()).toBe(true);

  let archiveBody: unknown = null;
  let archiveRequests = 0;
  const archiveRoute = '**/api/admin/clients/*/archive';

  await page.route(archiveRoute, async (route) => {
    archiveRequests += 1;
    archiveBody = route.request().postDataJSON();
    const requestUrl = new URL(route.request().url());
    const requestedClientId = decodeURIComponent(
      requestUrl.pathname.split('/').at(-2) || '',
    );
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          code: 'CLIENT_ARCHIVED',
          clientId: requestedClientId,
        },
      }),
    });
  });

  try {
    await page.goto(
      `${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`,
      { waitUntil: 'domcontentloaded' },
    );

    await page.getByTestId('owner-nav-clients').click();

    const firstClient = page
      .getByTestId('clients-directory-scroll')
      .locator('button')
      .first();

    await expect(firstClient).toBeVisible();

    await firstClient.click();

    await expect(page.getByTestId('client-delete-action')).toBeVisible();

    await page.getByTestId('client-delete-action').click();

    const dialog = page.getByTestId('client-archive-dialog');

    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: 'Delete client?' }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        'This client will be removed from your active client list. Their appointments, payments and history will be kept.',
      ),
    ).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();

    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width)
      .toBeLessThanOrEqual(viewport!.width);
    expect(dialogBox!.y + dialogBox!.height)
      .toBeLessThanOrEqual(viewport!.height);

    await expect.poll(() => page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))).toEqual({
      clientWidth: viewport!.width,
      scrollWidth: viewport!.width,
    });

    await page.evaluate(() => {
      const confirm = document.querySelector<HTMLButtonElement>(
        '[data-testid="client-archive-confirm"]',
      );
      confirm?.click();
      confirm?.click();
    });

    await expect.poll(() => archiveRequests).toBe(1);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('client-delete-action')).toBeHidden();
    await expect(page.getByTestId('clients-directory-scroll')).toBeVisible();
    await expect(page.getByTestId('client-lifecycle-success')).toHaveText(
      'Client deleted from the active list. Their history was kept.',
    );

    expect(archiveBody).toEqual({
      salonSlug: e2eConfig.salonSlug,
      expectedUpdatedAt: expect.any(String),
    });
  } finally {
    await page.unroute(archiveRoute);
    await page.request.delete('/api/super-admin/impersonate');
  }
});
