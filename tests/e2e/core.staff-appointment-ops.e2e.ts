import { expect, test, type Browser } from '@playwright/test';

import { authenticateCustomer } from './support/auth';
import {
  cancelAppointmentAsAdmin,
  clickNextAvailableAndWaitForManageResult,
  fetchManageAccessStatus,
  getAppointmentBlockState,
  getStaffTechnicianProfile,
  openStaffAppointmentSheet,
  selectCalendarDay,
} from './support/appointment-ops';
import { createAppointmentViaApi } from './support/booking';
import { appPath, authStatePaths, uniqueCustomerPhone } from './support/config';

test.use({ storageState: authStatePaths.staff });

async function createCustomerPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const phone = uniqueCustomerPhone();
  await authenticateCustomer(page, phone);
  return { context, page, phone };
}

async function createAssignedAndUnassignedAppointments(browser: Browser, technicianId: string) {
  const assignedCustomer = await createCustomerPage(browser);
  const unassignedCustomer = await createCustomerPage(browser);

  try {
    const assignedAppointment = await createAppointmentViaApi(assignedCustomer.page, {
      technicianId,
      clientPhone: assignedCustomer.phone,
      clientName: `Assigned ${assignedCustomer.phone.slice(-4)}`,
    });

    const unassignedAppointment = await createAppointmentViaApi(unassignedCustomer.page, {
      technicianId: null,
      clientPhone: unassignedCustomer.phone,
      clientName: `Unassigned ${unassignedCustomer.phone.slice(-4)}`,
    });

    return {
      assignedAppointment,
      unassignedAppointment,
      close: async () => {
        await assignedCustomer.context.close();
        await unassignedCustomer.context.close();
      },
    };
  } catch (error) {
    await assignedCustomer.context.close();
    await unassignedCustomer.context.close();
    throw error;
  }
}

test('staff can edit an assigned appointment and cannot manage an unassigned one', async ({ browser, page }) => {
  test.slow();
  const staffTechnician = await getStaffTechnicianProfile();
  const seeded = await createAssignedAndUnassignedAppointments(browser, staffTechnician.id);

  try {
    await page.goto(appPath('/staff/appointments'), {
      waitUntil: 'domcontentloaded',
    });

    await selectCalendarDay(page, seeded.assignedAppointment.dateString);
    await expect(page.getByTestId(`appointment-block-${seeded.assignedAppointment.id}`)).toBeVisible();
    await expect(page.getByTestId(`appointment-block-${seeded.unassignedAppointment.id}`)).toHaveCount(0);

    await openStaffAppointmentSheet(page, seeded.assignedAppointment.id, seeded.assignedAppointment.dateString);
    await expect(page.getByTestId('appointment-sheet-technician-select')).toBeDisabled();
    const originalState = await getAppointmentBlockState(page, seeded.assignedAppointment.id);
    const nextAvailableResult = await clickNextAvailableAndWaitForManageResult(page, seeded.assignedAppointment.id);
    expect(nextAvailableResult.ok, JSON.stringify(nextAvailableResult.body)).toBe(true);
    if (nextAvailableResult.ok) {
      expect(nextAvailableResult.calendarEvent.startTime).not.toBe(originalState.startTime);
    }

    const manageResult = await fetchManageAccessStatus(page, seeded.unassignedAppointment.id);
    expect(manageResult.ok, JSON.stringify(manageResult.body)).toBe(false);
    expect(manageResult.status).toBe(403);
  } finally {
    await seeded.close();
    await cancelAppointmentAsAdmin(seeded.assignedAppointment.id);
    await cancelAppointmentAsAdmin(seeded.unassignedAppointment.id);
  }
});

test('staff quick edit sheet remains usable on a mobile viewport', async ({ browser, page }) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  const staffTechnician = await getStaffTechnicianProfile();
  const seeded = await createAssignedAndUnassignedAppointments(browser, staffTechnician.id);

  try {
    await page.goto(appPath('/staff/appointments'), {
      waitUntil: 'domcontentloaded',
    });

    await openStaffAppointmentSheet(page, seeded.assignedAppointment.id, seeded.assignedAppointment.dateString);

    const saveButton = page.getByTestId('appointment-sheet-save');
    await expect(saveButton).toBeVisible();
    const saveBounds = await saveButton.boundingBox();
    expect(saveBounds).toBeTruthy();
    expect((saveBounds?.y ?? 0) + (saveBounds?.height ?? 0)).toBeLessThanOrEqual(844);

    await page.getByTestId('appointment-sheet-start-time').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('appointment-sheet-start-time')).toBeVisible();
    await page.getByTestId('appointment-sheet-next-available').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('appointment-sheet-next-available')).toBeVisible();
  } finally {
    await seeded.close();
    await cancelAppointmentAsAdmin(seeded.assignedAppointment.id);
    await cancelAppointmentAsAdmin(seeded.unassignedAppointment.id);
  }
});
