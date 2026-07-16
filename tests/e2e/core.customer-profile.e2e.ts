import { expect, test } from '@playwright/test';

import { createAppointmentViaApi } from './support/booking';
import { uniqueCustomerPhone } from './support/config';

test('guest can reschedule and cancel through the capability management link', async ({ page }) => {
  test.slow();

  const phone = uniqueCustomerPhone();
  const clientName = `Manage ${phone.slice(-4)}`;
  const clientEmail = `manage+${Date.now()}@example.com`;
  const originalAppointment = await createAppointmentViaApi(page, {
    clientName,
    clientEmail,
    clientPhone: phone,
    startDayOffset: 3,
  });

  expect(originalAppointment.manageUrl).toBeTruthy();

  await page.goto(originalAppointment.manageUrl!, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', {
    name: new RegExp(`${clientName}.+appointment`, 'i'),
  })).toBeVisible();

  await page.getByRole('link', { name: /choose a new time/i }).click();

  const manageToken = new URL(originalAppointment.manageUrl!).pathname
    .split('/')
    .filter(Boolean)
    .at(-1);
  const rescheduledAppointment = await createAppointmentViaApi(page, {
    clientName,
    clientEmail,
    clientPhone: phone,
    startDayOffset: 3,
    originalAppointmentId: originalAppointment.id,
    manageToken,
  });

  expect(rescheduledAppointment.id).not.toBe(originalAppointment.id);
  expect(rescheduledAppointment.manageUrl).toBeTruthy();

  await page.goto(rescheduledAppointment.manageUrl!, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: /cancel appointment/i })).toBeVisible();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: /cancel appointment/i }).click();

  await expect(page.getByText('This appointment is cancelled.')).toBeVisible();
});
