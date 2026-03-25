import { expect, test } from '@playwright/test';

import { authenticateCustomer } from './support/auth';
import {
  appPath,
  authStatePaths,
  e2eConfig,
  uniqueCustomerPhone,
} from './support/config';
import { createAppointmentViaApi } from './support/booking';

test.use({ storageState: authStatePaths.staff });

test('staff can start and complete a confirmed appointment from the dashboard', async ({ browser, page }) => {
  test.slow();
  const staffProfile = await page.goto(appPath('/staff'), {
    waitUntil: 'domcontentloaded',
  }).then(async () => page.evaluate(async () => {
    const response = await fetch('/api/staff/me', { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      body,
    };
  }));

  expect(staffProfile.ok, JSON.stringify(staffProfile.body)).toBeTruthy();

  const technicianId = staffProfile.body?.data?.technician?.id as string | undefined;
  expect(technicianId).toBeTruthy();

  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  const customerPhone = uniqueCustomerPhone();
  const clientName = `E2E Staff ${customerPhone.slice(-4)}`;

  await authenticateCustomer(customerPage, customerPhone);
  const appointment = await createAppointmentViaApi(customerPage, {
    technicianId,
    clientName,
    clientPhone: customerPhone,
  });
  await customerContext.close();

  const confirmResult = await page.evaluate(async ({ appointmentId }) => {
    const response = await fetch(`/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      body,
    };
  }, { appointmentId: appointment.id });

  expect(confirmResult.ok, JSON.stringify(confirmResult.body)).toBeTruthy();

  await page.goto(appPath('/staff'), {
    waitUntil: 'domcontentloaded',
  });

  const appointmentCard = page.getByTestId(`staff-appointment-${appointment.id}`);
  if (!(await appointmentCard.isVisible().catch(() => false)) && appointment.dateString !== new Date().toISOString().split('T')[0]) {
    await page.getByTestId('staff-dashboard-tab-upcoming').click();
  }

  await expect(appointmentCard).toBeVisible();
  await page.getByTestId(`staff-appointment-action-${appointment.id}`).click();

  await expect(page.getByTestId('staff-action-start')).toBeVisible();
  await page.getByTestId('staff-action-start').click();

  await expect(appointmentCard).toBeVisible();
  await page.getByTestId(`staff-appointment-action-${appointment.id}`).click();

  await expect(page.getByTestId('staff-action-complete')).toBeVisible();
  await page.getByTestId('staff-action-complete').click();

  await expect(appointmentCard).not.toBeVisible();
});
