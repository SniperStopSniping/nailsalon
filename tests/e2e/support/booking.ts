import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

import { e2eBaseUrl, e2eConfig } from './config';

type AvailabilityResponse = {
  visibleSlots?: string[];
  bookedSlots?: string[];
  error?: {
    message?: string;
  };
};

type CreatedAppointment = {
  id: string;
  startTime: string;
};

type HttpResult<T = unknown> = {
  ok: boolean;
  status: number;
  body: T | null;
};

function isoDate(date: Date) {
  return date.toISOString().split('T')[0] || '';
}

async function createAuthenticatedRequestContext(page: Page) {
  const storageState = await page.context().storageState();
  return playwrightRequest.newContext({
    baseURL: e2eBaseUrl,
    storageState,
  });
}

async function getJson<T>(
  requestContext: APIRequestContext,
  url: string,
): Promise<HttpResult<T>> {
  const response = await requestContext.get(url, { timeout: 60_000 });
  return {
    ok: response.ok(),
    status: response.status(),
    body: await response.json().catch(() => null) as T | null,
  };
}

async function postJson<T>(
  requestContext: APIRequestContext,
  url: string,
  body: unknown,
): Promise<HttpResult<T>> {
  const response = await requestContext.post(url, {
    data: body,
    timeout: 60_000,
  });
  return {
    ok: response.ok(),
    status: response.status(),
    body: await response.json().catch(() => null) as T | null,
  };
}

async function patchJson<T>(
  requestContext: APIRequestContext,
  url: string,
  body: unknown,
): Promise<HttpResult<T>> {
  const response = await requestContext.patch(url, {
    data: body,
    timeout: 60_000,
  });
  return {
    ok: response.ok(),
    status: response.status(),
    body: await response.json().catch(() => null) as T | null,
  };
}

export async function findBookableSlot(
  page: Page,
  options?: {
    technicianId?: string | null;
  daysToScan?: number;
  },
) {
  const daysToScan = options?.daysToScan ?? 21;
  const serviceIds = e2eConfig.serviceId;
  const requestContext = await createAuthenticatedRequestContext(page);

  try {
    for (let offset = 1; offset <= daysToScan; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      date.setHours(0, 0, 0, 0);

      const params = new URLSearchParams({
        date: isoDate(date),
        salonSlug: e2eConfig.salonSlug,
        durationMinutes: String(e2eConfig.serviceDurationMinutes),
        serviceIds,
      });

      if (options?.technicianId) {
        params.set('technicianId', options.technicianId);
      }

      const availability = await getJson<AvailabilityResponse>(
        requestContext,
        `/api/appointments/availability?${params.toString()}`,
      );

      expect(availability.ok, JSON.stringify(availability.body)).toBeTruthy();

      const body = availability.body as AvailabilityResponse | null;
      const visibleSlots = body?.visibleSlots ?? [];
      if (visibleSlots.length > 0) {
        return {
          date,
          dateString: isoDate(date),
          time: visibleSlots[0],
        };
      }
    }

    throw new Error(`No bookable slot found for ${e2eConfig.salonSlug} / ${e2eConfig.serviceId}`);
  } finally {
    await requestContext.dispose();
  }
}

export async function createAppointmentViaApi(
  page: Page,
  options?: {
    technicianId?: string | null;
    clientName?: string;
    clientPhone?: string;
  },
) {
  const maxAttempts = options?.technicianId ? 1 : 10;
  let attemptedSlots = 0;
  let lastFailure: { status: number; body: unknown } | null = null;
  const requestContext = await createAuthenticatedRequestContext(page);

  try {
    for (let offset = 1; offset <= 21; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      date.setHours(0, 0, 0, 0);

      const params = new URLSearchParams({
        date: isoDate(date),
        salonSlug: e2eConfig.salonSlug,
        durationMinutes: String(e2eConfig.serviceDurationMinutes),
        serviceIds: e2eConfig.serviceId,
      });

      if (options?.technicianId) {
        params.set('technicianId', options.technicianId);
      }

      const availability = await getJson<AvailabilityResponse>(
        requestContext,
        `/api/appointments/availability?${params.toString()}`,
      );

      expect(availability.ok, JSON.stringify(availability.body)).toBeTruthy();

      const visibleSlots = ((availability.body as AvailabilityResponse | null)?.visibleSlots ?? []).slice(0, maxAttempts);

      for (const time of visibleSlots) {
        attemptedSlots += 1;

        if (!time) {
          throw new Error('Missing time for E2E appointment creation.');
        }

        const [hours, minutes] = time.split(':').map(Number);
        const startTime = new Date(`${isoDate(date)}T00:00:00`);
        startTime.setHours(hours || 9, minutes || 0, 0, 0);

        const creationResult = await postJson<{ data?: { appointment?: CreatedAppointment } }>(
          requestContext,
          '/api/appointments',
          {
            salonSlug: e2eConfig.salonSlug,
            serviceIds: [e2eConfig.serviceId],
            technicianId: options?.technicianId ?? null,
            clientName: options?.clientName ?? undefined,
            clientPhone: options?.clientPhone ?? undefined,
            startTime: startTime.toISOString(),
          },
        );

        if (creationResult.ok) {
          const appointment = creationResult.body?.data?.appointment;
          if (!appointment?.id) {
            throw new Error(`Appointment creation did not return an id: ${JSON.stringify(creationResult.body)}`);
          }

          return {
            id: appointment.id,
            dateString: isoDate(date),
            time,
            startTime: appointment.startTime,
          };
        }

        lastFailure = {
          status: creationResult.status,
          body: creationResult.body,
        };

        const errorCode = typeof creationResult.body === 'object'
          && creationResult.body !== null
          && 'error' in creationResult.body
          && typeof (creationResult.body as { error?: unknown }).error === 'object'
          && (creationResult.body as { error?: { code?: string } }).error?.code
          ? (creationResult.body as { error?: { code?: string } }).error?.code
          : null;

        if (errorCode !== 'NO_AVAILABLE_TECHNICIAN' && errorCode !== 'TIME_CONFLICT') {
          expect(creationResult.ok, JSON.stringify(creationResult.body)).toBeTruthy();
        }
      }
    }

    throw new Error(
      `Unable to create an E2E appointment after ${attemptedSlots} slot attempts: ${JSON.stringify(lastFailure)}`,
    );
  } finally {
    await requestContext.dispose();
  }
}

export async function cancelAppointmentViaApi(page: Page, appointmentId: string) {
  const requestContext = await createAuthenticatedRequestContext(page);

  try {
    const cancelResult = await patchJson(
      requestContext,
      `/api/appointments/${appointmentId}/cancel`,
      { cancelReason: 'e2e_cleanup' },
    );

    expect(cancelResult.ok, JSON.stringify(cancelResult.body)).toBeTruthy();
  } finally {
    await requestContext.dispose();
  }
}

export async function pickFirstVisibleTimeSlot(page: Page) {
  const slotButtons = page.locator('[data-testid^="time-slot-"]:not([disabled])');
  await expect(slotButtons.first()).toBeVisible();
  await slotButtons.first().click();
}

export async function ensureTimeSlotVisible(page: Page) {
  const slotButtons = page.locator('[data-testid^="time-slot-"]:not([disabled])');

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await slotButtons.first().isVisible().catch(() => false)) {
      return;
    }

    const dayButtons: Locator = page.locator('[data-testid^="calendar-day-"]:not([disabled])');
    const count = await dayButtons.count();
    if (attempt >= count) {
      break;
    }

    await dayButtons.nth(attempt).click();
    if (await slotButtons.first().isVisible().catch(() => false)) {
      return;
    }
  }

  throw new Error('Could not find a visible time slot in the booking calendar.');
}

export async function selectDifferentCalendarDay(
  page: Page,
  currentDateKey: string,
) {
  const dayButtons = page.locator('[data-testid^="calendar-day-"]:not([disabled])');
  const count = await dayButtons.count();

  for (let index = 0; index < count; index += 1) {
    const button = dayButtons.nth(index);
    const testId = await button.getAttribute('data-testid');
    if (!testId) {
      continue;
    }

    if (testId !== `calendar-day-${currentDateKey}`) {
      await button.click();
      return;
    }
  }

  throw new Error(`Could not find a second calendar day different from ${currentDateKey}.`);
}
