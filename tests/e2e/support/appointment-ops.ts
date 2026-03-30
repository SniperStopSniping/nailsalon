import { expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';

import { appPath, appPathPattern, authStatePaths, e2eBaseUrl, e2eConfig } from './config';

type SuperAdminOrganization = {
  id: string;
  slug?: string;
  name?: string;
};

function slotTestId(resourceId: string, dateString: string, time: string) {
  return `calendar-slot-${resourceId}-${dateString}-${time.replace(':', '-')}`;
}

function dateKeyFromIso(iso: string) {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resourceIdFromCalendarEvent(technicianId: string | null | undefined) {
  return technicianId ?? 'unassigned';
}

type ManageMutationResponse = {
  data?: {
    calendarEvent?: {
      id: string;
      startTime: string;
      endTime: string;
      technicianId: string | null;
    };
  };
  error?: unknown;
};

async function fetchTargetSalon(context: APIRequestContext) {
  const response = await context.get(
    `/api/super-admin/organizations?page=1&pageSize=50&q=${encodeURIComponent(e2eConfig.salonName)}`,
  );
  const body = await response.json().catch(() => null) as { items?: SuperAdminOrganization[] } | null;
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();

  const target = body?.items?.find((item) => item.slug === e2eConfig.salonSlug)
    ?? body?.items?.[0]
    ?? null;

  expect(target?.id, `Missing target salon for ${e2eConfig.salonSlug}`).toBeTruthy();
  return target!;
}

export async function createImpersonatedAdminRequestContext() {
  const context = await playwrightRequest.newContext({
    baseURL: e2eBaseUrl,
    storageState: authStatePaths.superAdmin,
  });

  const targetSalon = await fetchTargetSalon(context);
  const response = await context.post('/api/super-admin/impersonate', {
    data: { salonId: targetSalon.id },
  });
  const body = await response.json().catch(() => null);
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();

  return context;
}

export async function getStaffTechnicianProfile() {
  const context = await playwrightRequest.newContext({
    baseURL: e2eBaseUrl,
    storageState: authStatePaths.staff,
  });

  try {
    const response = await context.get('/api/staff/me');
    const body = await response.json().catch(() => null) as {
      data?: {
        technician?: {
          id: string;
          name: string | null;
        };
      };
    } | null;
    expect(response.ok(), JSON.stringify(body)).toBeTruthy();
    expect(body?.data?.technician?.id).toBeTruthy();
    return body!.data!.technician!;
  } finally {
    await context.dispose();
  }
}

export async function cancelAppointmentAsAdmin(appointmentId: string) {
  const context = await createImpersonatedAdminRequestContext();

  try {
    const response = await context.patch(`/api/appointments/${appointmentId}/cancel`, {
      data: { cancelReason: 'client_request' },
    });
    const body = await response.json().catch(() => null);
    expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  } finally {
    await context.dispose();
  }
}

export async function impersonateSalonAsSuperAdmin(page: Page) {
  await page.goto(`${appPath('/book/service')}?salonSlug=${encodeURIComponent(e2eConfig.salonSlug)}`, {
    waitUntil: 'domcontentloaded',
  });

  const listResponse = await page.request.get(
    `/api/super-admin/organizations?page=1&pageSize=50&q=${encodeURIComponent(e2eConfig.salonName)}`,
  );
  const listBody = await listResponse.json().catch(() => null) as { items?: SuperAdminOrganization[] } | null;
  expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();

  const targetSalon = listBody?.items?.find((item) => item.slug === e2eConfig.salonSlug)
    ?? listBody?.items?.[0]
    ?? null;

  expect(targetSalon?.id, `Missing target salon id for ${e2eConfig.salonSlug}`).toBeTruthy();

  const response = await page.request.post('/api/super-admin/impersonate', {
    data: { salonId: targetSalon!.id },
  });
  const body = await response.json().catch(() => null);
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
}

export async function openAdminBookings(page: Page) {
  await impersonateSalonAsSuperAdmin(page);
  await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(appPathPattern('/admin'));
  const pageTwoButton = page.getByRole('button', { name: 'Go to page 2' });
  if (await pageTwoButton.isVisible().catch(() => false)) {
    await pageTwoButton.click();
  }
  await page.getByTestId('admin-app-tile-bookings').click();
  await expect(page.getByRole('button', { name: /next week/i })).toBeVisible();
}

async function getSelectedCalendarDay(page: Page) {
  const selected = page.locator('[data-testid^="calendar-day-"][data-selected="true"]').first();
  await expect(selected).toBeVisible();
  const testId = await selected.getAttribute('data-testid');
  return testId?.replace('calendar-day-', '') ?? null;
}

export async function ensureCalendarDayVisible(page: Page, dateString: string) {
  const targetDate = new Date(`${dateString}T00:00:00`);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const dayButton = page.getByTestId(`calendar-day-${dateString}`);
    if (await dayButton.isVisible().catch(() => false)) {
      return dayButton;
    }

    const selectedDateKey = await getSelectedCalendarDay(page);
    if (!selectedDateKey) {
      break;
    }

    const selectedDate = new Date(`${selectedDateKey}T00:00:00`);
    const goForward = targetDate.getTime() >= selectedDate.getTime();

    await page.getByRole('button', { name: goForward ? /next week/i : /previous week/i }).click();
  }

  throw new Error(`Could not make calendar day ${dateString} visible.`);
}

export async function selectCalendarDay(page: Page, dateString: string) {
  const dayButton = await ensureCalendarDayVisible(page, dateString);
  if ((await dayButton.getAttribute('data-selected')) === 'true') {
    await expect(dayButton).toHaveAttribute('data-selected', 'true');
    return;
  }
  await dayButton.click();
  await expect(dayButton).toHaveAttribute('data-selected', 'true');
}

export async function getAppointmentBlock(page: Page, appointmentId: string) {
  const block = page.getByTestId(`appointment-block-${appointmentId}`);
  await expect(block).toBeVisible();
  return block;
}

export async function getAppointmentBlockState(page: Page, appointmentId: string) {
  const block = await getAppointmentBlock(page, appointmentId);

  return {
    block,
    startTime: await block.getAttribute('data-start-time'),
    endTime: await block.getAttribute('data-end-time'),
    resourceId: await block.getAttribute('data-resource-id'),
    dateKey: await block.getAttribute('data-date-key'),
  };
}

export async function waitForAppointmentBlockState(page: Page, args: {
  appointmentId: string;
  startTime: string;
  endTime: string;
  resourceId: string;
  dateKey: string;
}) {
  const expected = JSON.stringify({
    startTime: args.startTime,
    endTime: args.endTime,
    resourceId: args.resourceId,
    dateKey: args.dateKey,
  });
  let lastState: Record<string, string | null> | null = null;

  try {
    await expect.poll(async () => {
      const current = await getAppointmentBlockState(page, args.appointmentId);
      lastState = {
        startTime: current.startTime,
        endTime: current.endTime,
        resourceId: current.resourceId,
        dateKey: current.dateKey,
      };
      return JSON.stringify(lastState);
    }).toBe(expected);
  } catch (error) {
    const selectedDay = await getSelectedCalendarDay(page).catch(() => null);
    const visibleBlocks = await page.locator('[data-testid^="appointment-block-"]').evaluateAll((elements) => (
      elements.map((element) => ({
        testId: element.getAttribute('data-testid'),
        startTime: element.getAttribute('data-start-time'),
        resourceId: element.getAttribute('data-resource-id'),
        dateKey: element.getAttribute('data-date-key'),
      }))
    )).catch(() => []);
    const details = lastState ? JSON.stringify(lastState) : 'unavailable';
    throw new Error(
      `Appointment block ${args.appointmentId} did not settle to expected state. expected=${expected} actual=${details} selectedDay=${selectedDay ?? 'unknown'} visibleBlocks=${JSON.stringify(visibleBlocks)}${error instanceof Error ? ` cause=${error.message}` : ''}`,
    );
  }
}

export async function dragAppointmentToSlot(page: Page, args: {
  appointmentId: string;
  resourceId: string;
  dateString: string;
  time: string;
}) {
  const handle = page.getByTestId(`appointment-drag-handle-${args.appointmentId}`);
  const slot = page.getByTestId(slotTestId(args.resourceId, args.dateString, args.time));

  await expect(handle).toBeVisible();
  await expect(slot).toBeVisible();

  const handleBox = await handle.boundingBox();
  const slotBox = await slot.boundingBox();
  if (!handleBox || !slotBox) {
    throw new Error('Missing drag handle or target slot bounds.');
  }

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2, { steps: 12 });
  await page.mouse.up();
}

export async function dragAppointmentToSlotAndWaitForManageResult(page: Page, args: {
  appointmentId: string;
  resourceId: string;
  dateString: string;
  time: string;
}) {
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes(`/api/appointments/${args.appointmentId}/manage`)
    && response.request().method() === 'PATCH'
  ));

  await dragAppointmentToSlot(page, args);

  const response = await responsePromise;
  const body = await response.json().catch(() => null) as ManageMutationResponse | null;

  if (!response.ok()) {
    return {
      ok: false as const,
      status: response.status(),
      body,
    };
  }

  const calendarEvent = body?.data?.calendarEvent;
  expect(calendarEvent?.id, JSON.stringify(body)).toBe(args.appointmentId);

  try {
    await waitForAppointmentBlockState(page, {
      appointmentId: args.appointmentId,
      startTime: calendarEvent!.startTime,
      endTime: calendarEvent!.endTime,
      resourceId: resourceIdFromCalendarEvent(calendarEvent!.technicianId),
      dateKey: dateKeyFromIso(calendarEvent!.startTime),
    });
  } catch (error) {
    throw new Error(
      `Manage move response settled but the appointment block did not. response=${JSON.stringify(body)}${error instanceof Error ? ` cause=${error.message}` : ''}`,
    );
  }

  return {
    ok: true as const,
    status: response.status(),
    body,
    calendarEvent: calendarEvent!,
  };
}

export async function clickNextAvailableAndWaitForManageResult(page: Page, appointmentId: string) {
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes(`/api/appointments/${appointmentId}/manage`)
    && response.request().method() === 'PATCH'
  ));

  await page.getByTestId('appointment-sheet-next-available').click();

  const response = await responsePromise;
  const body = await response.json().catch(() => null) as ManageMutationResponse | null;

  if (!response.ok()) {
    return {
      ok: false as const,
      status: response.status(),
      body,
    };
  }

  const calendarEvent = body?.data?.calendarEvent;
  expect(calendarEvent?.id, JSON.stringify(body)).toBe(appointmentId);

  try {
    await waitForAppointmentBlockState(page, {
      appointmentId,
      startTime: calendarEvent!.startTime,
      endTime: calendarEvent!.endTime,
      resourceId: resourceIdFromCalendarEvent(calendarEvent!.technicianId),
      dateKey: dateKeyFromIso(calendarEvent!.startTime),
    });
  } catch (error) {
    throw new Error(
      `Next available response settled but the appointment block did not. response=${JSON.stringify(body)}${error instanceof Error ? ` cause=${error.message}` : ''}`,
    );
  }

  return {
    ok: true as const,
    status: response.status(),
    body,
    calendarEvent: calendarEvent!,
  };
}

export async function waitForSheet(page: Page) {
  const sheet = page.getByTestId('appointment-quick-edit-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function openAdminAppointmentSheet(page: Page, appointmentId: string, dateString: string) {
  await selectCalendarDay(page, dateString);
  const block = await getAppointmentBlock(page, appointmentId);
  await block.click();
  await waitForSheet(page);
}

export async function openStaffAppointmentSheet(page: Page, appointmentId: string, dateString: string) {
  await selectCalendarDay(page, dateString);
  const block = await getAppointmentBlock(page, appointmentId);
  await block.click();
  await waitForSheet(page);
}

export async function chooseDifferentTechnician(page: Page) {
  const select = page.getByTestId('appointment-sheet-technician-select');
  const options = await select.locator('option').allTextContents();
  const currentValue = await select.inputValue();

  for (let index = 0; index < options.length; index += 1) {
    const optionValue = await select.locator('option').nth(index).getAttribute('value');
    if (!optionValue || optionValue === currentValue || optionValue === '') {
      continue;
    }
    await select.selectOption(optionValue);
    return optionValue;
  }

  throw new Error('No alternative technician option available for reassignment.');
}

export async function fetchManageAccessStatus(page: Page, appointmentId: string) {
  return page.evaluate(async ({ targetAppointmentId }) => {
    const response = await fetch(`/api/appointments/${targetAppointmentId}/manage`, { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  }, { targetAppointmentId: appointmentId });
}

export async function getAdminServiceByName(name: string) {
  const context = await createImpersonatedAdminRequestContext();

  try {
    const response = await context.get(`/api/salon/services?salonSlug=${encodeURIComponent(e2eConfig.salonSlug)}`);
    const body = await response.json().catch(() => null) as {
      data?: { services?: Array<{ id: string; name: string }> };
    } | null;
    expect(response.ok(), JSON.stringify(body)).toBeTruthy();
    const match = body?.data?.services?.find((service) => service.name === name) ?? null;
    expect(match?.id, `Missing admin service named ${name}`).toBeTruthy();
    return match!;
  } finally {
    await context.dispose();
  }
}
