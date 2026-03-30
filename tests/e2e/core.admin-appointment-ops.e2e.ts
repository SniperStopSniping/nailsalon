import { expect, test, type Browser, type Page } from '@playwright/test';

import { authenticateCustomer } from './support/auth';
import {
  cancelAppointmentAsAdmin,
  clickNextAvailableAndWaitForManageResult,
  chooseDifferentTechnician,
  dragAppointmentToSlotAndWaitForManageResult,
  getAdminServiceByName,
  getAppointmentBlockState,
  getStaffTechnicianProfile,
  openAdminAppointmentSheet,
  openAdminBookings,
  selectCalendarDay,
} from './support/appointment-ops';
import {
  createAppointmentViaApi,
  getSelectableSlotsForDate,
  selectBookableSlotFromApi,
} from './support/booking';
import { appPath, appPathPattern, authStatePaths, e2eConfig, uniqueCustomerPhone } from './support/config';

test.use({ storageState: authStatePaths.superAdmin });

async function getBrowserDateKey(page: Page, iso: string) {
  return page.evaluate((targetIso) => {
    const date = new Date(targetIso);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, iso);
}

async function createCustomerPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const phone = uniqueCustomerPhone();
  await authenticateCustomer(page, phone);
  return { context, page, phone };
}

async function createAssignedAppointment(browser: Browser, args: {
  technicianId: string;
  startTime?: string;
}) {
  const { context, page, phone } = await createCustomerPage(browser);

  try {
    return await createAppointmentViaApi(page, {
      technicianId: args.technicianId,
      clientPhone: phone,
      clientName: `Ops ${phone.slice(-4)}`,
      startTime: args.startTime,
    });
  } finally {
    await context.close();
  }
}

async function createCustomerBookingWithAddOn(browser: Browser) {
  const { context, page, phone } = await createCustomerPage(browser);

  try {
    let appointmentId: string | null = null;

    await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: /choose your service/i })).toBeVisible();

    await page.getByRole('button', { name: /gel manicure/i }).click();

    const addOnTitle = page.locator('div').filter({ hasText: 'Simple Nail Art' }).first();
    await expect(addOnTitle).toBeVisible();
    await addOnTitle.getByRole('button', { name: /^add$/i }).click();

    await page.getByTestId('service-continue-button').click();
    await expect(page).toHaveURL(appPathPattern('/book/tech'));

    await page.getByRole('button', { name: new RegExp(e2eConfig.staffTechnicianName, 'i') }).click();
    await expect(page).toHaveURL(appPathPattern('/book/time'));

    const timeStepUrl = new URL(page.url());
    await selectBookableSlotFromApi(page, {
      technicianId: timeStepUrl.searchParams.get('techId'),
      baseServiceId: timeStepUrl.searchParams.get('baseServiceId'),
      locationId: timeStepUrl.searchParams.get('locationId'),
      selectedAddOns: timeStepUrl.searchParams.get('selectedAddOns'),
    });

    await expect(page).toHaveURL(appPathPattern('/book/confirm'));
    const bookingResponsePromise = page.waitForResponse(response => (
      response.url().includes('/api/appointments')
      && response.request().method() === 'POST'
      && response.status() === 201
    ));

    await page.getByRole('button', { name: /confirm appointment/i }).click();
    const bookingResponse = await bookingResponsePromise;
    const body = await bookingResponse.json();
    appointmentId = body?.data?.appointment?.id ?? null;

    expect(appointmentId).toBeTruthy();
    const appointmentDateKey = await getBrowserDateKey(page, body?.data?.appointment?.startTime ?? '');

    return {
      appointmentId: appointmentId!,
      dateString: appointmentDateKey,
      addOnName: 'Simple Nail Art',
    };
  } finally {
    await context.close();
  }
}

test('admin can open the quick edit sheet, drag to a new slot, and use next available', async ({ browser, page }) => {
  test.slow();
  const staffTechnician = await getStaffTechnicianProfile();
  const appointment = await createAssignedAppointment(browser, { technicianId: staffTechnician.id });

  try {
    await openAdminBookings(page);
    await openAdminAppointmentSheet(page, appointment.id, appointment.dateString);
    await expect(page.getByTestId('appointment-sheet-next-available')).toBeVisible();
    await page.getByTestId('appointment-sheet-close').click();
    await selectCalendarDay(page, appointment.dateString);

    const original = await getAppointmentBlockState(page, appointment.id);
    const selectableSlots = await getSelectableSlotsForDate(page, {
      dateString: appointment.dateString,
      technicianId: staffTechnician.id,
    });
    const successSlot = selectableSlots.find(slot => slot.time !== appointment.time);
    expect(successSlot, `No alternate slot found for ${appointment.dateString}`).toBeTruthy();

    const moveResult = await dragAppointmentToSlotAndWaitForManageResult(page, {
      appointmentId: appointment.id,
      resourceId: original.resourceId ?? staffTechnician.id,
      dateString: appointment.dateString,
      time: successSlot!.time,
    });
    expect(moveResult.ok, JSON.stringify(moveResult.body)).toBe(true);

    const confirmedMove = moveResult.ok ? moveResult.calendarEvent : null;
    expect(confirmedMove?.startTime).not.toBe(original.startTime);

    await openAdminAppointmentSheet(page, appointment.id, confirmedMove ? await getBrowserDateKey(page, confirmedMove.startTime) : appointment.dateString);
    const movedStartTime = await page.getByTestId('appointment-sheet-start-time').inputValue();
    const nextAvailableResult = await clickNextAvailableAndWaitForManageResult(page, appointment.id);
    expect(nextAvailableResult.ok, JSON.stringify(nextAvailableResult.body)).toBe(true);

    await expect(page.getByTestId('appointment-sheet-start-time')).not.toHaveValue(movedStartTime);
  } finally {
    await cancelAppointmentAsAdmin(appointment.id);
  }
});

test('admin conflicting drag drop reverts and shows inline error', async ({ browser, page }) => {
  test.slow();
  const staffTechnician = await getStaffTechnicianProfile();
  const firstAppointment = await createAssignedAppointment(browser, { technicianId: staffTechnician.id });
  const availableAfterFirst = await createCustomerPage(browser);
  let secondAppointmentId: string | null = null;

  try {
    const remainingSlots = await getSelectableSlotsForDate(availableAfterFirst.page, {
      dateString: firstAppointment.dateString,
      technicianId: staffTechnician.id,
    });
    const conflictSlot = remainingSlots.find(slot => slot.time !== firstAppointment.time);
    expect(conflictSlot, 'No conflict slot available after first appointment').toBeTruthy();

    const secondAppointment = await createAppointmentViaApi(availableAfterFirst.page, {
      technicianId: staffTechnician.id,
      clientPhone: availableAfterFirst.phone,
      clientName: `Ops ${availableAfterFirst.phone.slice(-4)}`,
      startTime: new Date(`${conflictSlot!.dateString}T${conflictSlot!.time}:00`).toISOString(),
    });
    secondAppointmentId = secondAppointment.id;

    await openAdminBookings(page);
    await selectCalendarDay(page, firstAppointment.dateString);
    const original = await getAppointmentBlockState(page, firstAppointment.id);

    const moveResult = await dragAppointmentToSlotAndWaitForManageResult(page, {
      appointmentId: firstAppointment.id,
      resourceId: original.resourceId ?? staffTechnician.id,
      dateString: firstAppointment.dateString,
      time: conflictSlot!.time,
    });
    expect(moveResult.ok, JSON.stringify(moveResult.body)).toBe(false);

    await expect(page.getByTestId('appointment-sheet-inline-error')).toBeVisible();
    await expect(page.getByTestId('appointment-sheet-inline-error')).toContainText(/unable to update appointment/i);

    await expect.poll(async () => {
      const current = await getAppointmentBlockState(page, firstAppointment.id);
      return JSON.stringify({
        startTime: current.startTime,
        resourceId: current.resourceId,
        dateKey: current.dateKey,
      });
    }).toBe(JSON.stringify({
      startTime: original.startTime,
      resourceId: original.resourceId,
      dateKey: original.dateKey,
    }));
  } finally {
    await availableAfterFirst.context.close();
    await cancelAppointmentAsAdmin(firstAppointment.id);
    if (secondAppointmentId) {
      await cancelAppointmentAsAdmin(secondAppointmentId);
    }
  }
});

test('admin can reassign technician from the quick edit sheet', async ({ browser, page }) => {
  test.slow();
  const staffTechnician = await getStaffTechnicianProfile();
  const appointment = await createAssignedAppointment(browser, { technicianId: staffTechnician.id });

  try {
    await openAdminBookings(page);
    await openAdminAppointmentSheet(page, appointment.id, appointment.dateString);
    const blockBefore = await getAppointmentBlockState(page, appointment.id);
    await chooseDifferentTechnician(page);
    await page.getByTestId('appointment-sheet-save').click();

    await expect.poll(async () => {
      const current = await getAppointmentBlockState(page, appointment.id);
      return current.resourceId;
    }).not.toBe(blockBefore.resourceId);
  } finally {
    await cancelAppointmentAsAdmin(appointment.id);
  }
});

test('admin service change recalculates values, removes incompatible add-ons, and persists after reopen', async ({ browser, page }) => {
  test.slow();
  const colourChange = await getAdminServiceByName('Colour Change');
  const booked = await createCustomerBookingWithAddOn(browser);

  try {
    await openAdminBookings(page);
    await openAdminAppointmentSheet(page, booked.appointmentId, booked.dateString);

    await expect(page.getByTestId('appointment-sheet-addons')).toContainText(booked.addOnName);
    await page.getByTestId('appointment-sheet-service-select').selectOption(colourChange.id);
    await expect(page.getByTestId('appointment-sheet-projected-duration')).toContainText('30 min');
    await expect(page.getByTestId('appointment-sheet-projected-price')).toContainText('$25.00');
    await page.getByTestId('appointment-sheet-save').click();

    await expect(page.getByTestId('appointment-sheet-warning')).toContainText(/removed/i);
    await expect(page.getByTestId('appointment-sheet-projected-duration')).toContainText('30 min');
    await expect(page.getByTestId('appointment-sheet-projected-price')).toContainText('$25.00');
    await expect(page.getByTestId('appointment-sheet-addons')).toHaveCount(0);

    await page.getByTestId('appointment-sheet-close').click();
    await openAdminAppointmentSheet(page, booked.appointmentId, booked.dateString);

    await expect(page.getByTestId('appointment-sheet-service-select')).toHaveValue(colourChange.id);
    await expect(page.getByTestId('appointment-sheet-projected-duration')).toContainText('30 min');
    await expect(page.getByTestId('appointment-sheet-projected-price')).toContainText('$25.00');
    await expect(page.getByTestId('appointment-sheet-addons')).toHaveCount(0);
  } finally {
    await cancelAppointmentAsAdmin(booked.appointmentId);
  }
});
