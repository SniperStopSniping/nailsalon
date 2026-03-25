import { expect, test } from '@playwright/test';

import { authenticateCustomer } from './support/auth';
import {
  createAppointmentViaApi,
  ensureTimeSlotVisible,
  selectDifferentCalendarDay,
  pickFirstVisibleTimeSlot,
} from './support/booking';
import {
  appPath,
  appPathPattern,
  e2eConfig,
  uniqueCustomerPhone,
} from './support/config';

test('customer can reschedule from profile and then cancel the updated appointment', async ({ page }) => {
  test.slow();
  const phone = uniqueCustomerPhone();

  await authenticateCustomer(page, phone);
  const originalAppointment = await createAppointmentViaApi(page, {
    clientPhone: phone,
  });

  await expect(page.getByTestId('profile-manage-booking')).toBeVisible();
  const appointmentDate = new Date(originalAppointment.startTime);
  const rescheduleParams = new URLSearchParams({
    salonSlug: e2eConfig.salonSlug,
    serviceIds: e2eConfig.serviceId,
    techId: 'any',
    originalAppointmentId: originalAppointment.id,
    date: appointmentDate.toISOString().split('T')[0] ?? '',
    time: `${appointmentDate.getHours()}:${appointmentDate.getMinutes().toString().padStart(2, '0')}`,
  });

  await page.goto(`${appPath('/change-appointment')}?${rescheduleParams.toString()}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(appPathPattern('/change-appointment'));

  await selectDifferentCalendarDay(page, originalAppointment.dateString);
  await ensureTimeSlotVisible(page);
  await pickFirstVisibleTimeSlot(page);

  await page.getByRole('button', { name: /confirm changes/i }).click();
  await expect(page).toHaveURL(appPathPattern('/book/confirm'));

  const rescheduleResponsePromise = page.waitForResponse(response => (
    response.url().includes('/api/appointments')
    && response.request().method() === 'POST'
    && response.status() === 201
  ));

  await page.getByRole('button', { name: /confirm appointment/i }).click();
  await rescheduleResponsePromise;

  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();

  await page.goto(`${appPath('/profile')}?salonSlug=${e2eConfig.salonSlug}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('profile-manage-booking')).toBeVisible();

  const nextAppointment = await page.evaluate(async (salonSlug) => {
    const response = await fetch(`/api/client/next-appointment?salonSlug=${encodeURIComponent(salonSlug)}`, {
      cache: 'no-store',
    });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      body,
    };
  }, e2eConfig.salonSlug);

  expect(nextAppointment.ok, JSON.stringify(nextAppointment.body)).toBeTruthy();
  const currentAppointment = nextAppointment.body?.data?.appointment;
  expect(currentAppointment?.id).toBeTruthy();

  const currentStartTime = new Date(currentAppointment.startTime as string);
  const cancelParams = new URLSearchParams({
    salonSlug: e2eConfig.salonSlug,
    serviceIds: e2eConfig.serviceId,
    techId: 'any',
    originalAppointmentId: currentAppointment.id as string,
    date: currentStartTime.toISOString().split('T')[0] ?? '',
    time: `${currentStartTime.getHours()}:${currentStartTime.getMinutes().toString().padStart(2, '0')}`,
  });

  await page.goto(`${appPath('/change-appointment')}?${cancelParams.toString()}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('button', { name: /cancel appointment/i })).toBeVisible();
  await page.getByRole('button', { name: /cancel appointment/i }).click();
  await page.getByRole('button', { name: /yes, cancel/i }).click();

  await expect(page).toHaveURL(appPathPattern('/profile'));
  await expect(page).toHaveURL(/cancelled=true/);
});
