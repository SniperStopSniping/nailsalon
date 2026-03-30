import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

import { serializeSelectedAddOns, type SelectedAddOnParam } from '@/libs/bookingParams';

import { authStatePaths, e2eBaseUrl, e2eConfig } from './config';

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

export type AvailabilitySlot = {
  date: Date;
  dateString: string;
  time: string;
};

type FindBookableSlotOptions = {
  technicianId?: string | null;
  daysToScan?: number;
  dateString?: string | null;
  count?: number;
  baseServiceId?: string | null;
  serviceIds?: string[];
  selectedAddOns?: SelectedAddOnParam[];
  locationId?: string | null;
  selectedAddOnsParam?: string | null;
};

type HttpResult<T = unknown> = {
  ok: boolean;
  status: number;
  body: T | null;
};

function isoDate(date: Date) {
  return date.toISOString().split('T')[0] || '';
}

async function getBrowserStartParts(page: Page, iso: string) {
  return page.evaluate((targetIso) => {
    const date = new Date(targetIso);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return {
      dateString: `${year}-${month}-${day}`,
      time: `${hours}:${minutes}`,
    };
  }, iso);
}

function availabilityRequestMatches(args: {
  url: string;
  dateString: string;
  technicianId?: string | null;
  baseServiceId?: string | null;
  locationId?: string | null;
  selectedAddOns?: string | null;
}) {
  const url = new URL(args.url);
  if (!url.pathname.endsWith('/api/appointments/availability')) {
    return false;
  }

  const params = url.searchParams;
  if (params.get('date') !== args.dateString) {
    return false;
  }
  if (params.get('salonSlug') !== e2eConfig.salonSlug) {
    return false;
  }
  if ((params.get('technicianId') || null) !== (args.technicianId ?? null)) {
    return false;
  }
  if ((params.get('baseServiceId') || null) !== (args.baseServiceId ?? null)) {
    return false;
  }
  if ((params.get('locationId') || null) !== (args.locationId ?? null)) {
    return false;
  }
  if ((params.get('selectedAddOns') || null) !== (args.selectedAddOns ?? null)) {
    return false;
  }

  return true;
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

async function findBookableSlotsInternal(
  page: Page,
  options?: FindBookableSlotOptions,
): Promise<AvailabilitySlot[]> {
  const daysToScan = options?.daysToScan ?? 21;
  const serviceIds = options?.serviceIds ?? [e2eConfig.serviceId];
  const requestContext = await createAuthenticatedRequestContext(page);
  const selectedAddOnsParam = options?.selectedAddOnsParam
    ?? serializeSelectedAddOns(options?.selectedAddOns ?? []);
  const count = options?.count ?? 1;

  try {
    const dateCandidates = options?.dateString
      ? [options.dateString]
      : Array.from({ length: daysToScan }, (_, index) => {
          const date = new Date();
          date.setDate(date.getDate() + index + 1);
          date.setHours(0, 0, 0, 0);
          return isoDate(date);
        });

    for (const candidateDate of dateCandidates) {
      const date = new Date(`${candidateDate}T00:00:00`);
      const params = new URLSearchParams({
        date: candidateDate,
        salonSlug: e2eConfig.salonSlug,
      });

      if (options?.baseServiceId) {
        params.set('baseServiceId', options.baseServiceId);
        if (options.locationId) {
          params.set('locationId', options.locationId);
        }
        if (selectedAddOnsParam) {
          params.set('selectedAddOns', selectedAddOnsParam);
        }
      } else {
        params.set('durationMinutes', String(e2eConfig.serviceDurationMinutes));
        params.set('serviceIds', serviceIds.join(','));
      }

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
      const bookedSlots = new Set(body?.bookedSlots ?? []);
      const selectableSlots = visibleSlots.filter((slot) => !bookedSlots.has(slot));

      if (selectableSlots.length >= count) {
        return selectableSlots.slice(0, count).map((time) => ({
          date,
          dateString: candidateDate,
          time,
        }));
      }
    }

    throw new Error(`No bookable slot found for ${e2eConfig.salonSlug} / ${serviceIds.join(',')}`);
  } finally {
    await requestContext.dispose();
  }
}

export async function findBookableSlot(
  page: Page,
  options?: Omit<FindBookableSlotOptions, 'count'>,
): Promise<AvailabilitySlot> {
  const [slot] = await findBookableSlotsInternal(page, { ...options, count: 1 });
  if (!slot) {
    throw new Error(`No bookable slot found for ${e2eConfig.salonSlug}.`);
  }
  return slot;
}

export async function findBookableSlots(
  page: Page,
  options?: FindBookableSlotOptions,
): Promise<AvailabilitySlot[]> {
  return findBookableSlotsInternal(page, { ...options, count: options?.count ?? 2 });
}

export async function getSelectableSlotsForDate(
  page: Page,
  options: {
    dateString: string;
    technicianId?: string | null;
    baseServiceId?: string | null;
    serviceIds?: string[];
    selectedAddOns?: SelectedAddOnParam[];
    locationId?: string | null;
    selectedAddOnsParam?: string | null;
  },
) {
  const requestContext = await createAuthenticatedRequestContext(page);
  const serviceIds = options.serviceIds ?? [e2eConfig.serviceId];
  const selectedAddOnsParam = options.selectedAddOnsParam
    ?? serializeSelectedAddOns(options.selectedAddOns ?? []);

  try {
    const params = new URLSearchParams({
      date: options.dateString,
      salonSlug: e2eConfig.salonSlug,
    });

    if (options.baseServiceId) {
      params.set('baseServiceId', options.baseServiceId);
      if (options.locationId) {
        params.set('locationId', options.locationId);
      }
      if (selectedAddOnsParam) {
        params.set('selectedAddOns', selectedAddOnsParam);
      }
    } else {
      params.set('durationMinutes', String(e2eConfig.serviceDurationMinutes));
      params.set('serviceIds', serviceIds.join(','));
    }

    if (options.technicianId) {
      params.set('technicianId', options.technicianId);
    }

    const availability = await getJson<AvailabilityResponse>(
      requestContext,
      `/api/appointments/availability?${params.toString()}`,
    );
    expect(availability.ok, JSON.stringify(availability.body)).toBeTruthy();

    const body = availability.body as AvailabilityResponse | null;
    const visibleSlots = body?.visibleSlots ?? [];
    const bookedSlots = new Set(body?.bookedSlots ?? []);

    return visibleSlots
      .filter((slot) => !bookedSlots.has(slot))
      .map((time) => ({
        date: new Date(`${options.dateString}T00:00:00`),
        dateString: options.dateString,
        time,
      }));
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
    startTime?: string;
    serviceIds?: string[];
    baseServiceId?: string | null;
    selectedAddOns?: SelectedAddOnParam[];
    locationId?: string | null;
  },
) {
  const serviceIds = options?.serviceIds ?? [e2eConfig.serviceId];
  const selectedAddOns = options?.selectedAddOns ?? [];

  if (options?.startTime) {
    const requestContext = await createAuthenticatedRequestContext(page);

    try {
      const creationResult = await postJson<{ data?: { appointment?: CreatedAppointment } }>(
        requestContext,
        '/api/appointments',
        {
          salonSlug: e2eConfig.salonSlug,
          serviceIds: options.baseServiceId ? undefined : serviceIds,
          baseServiceId: options.baseServiceId ?? undefined,
          selectedAddOns,
          technicianId: options?.technicianId ?? null,
          clientName: options?.clientName ?? undefined,
          clientPhone: options?.clientPhone ?? undefined,
          locationId: options?.locationId ?? undefined,
          startTime: options.startTime,
        },
      );

      expect(creationResult.ok, JSON.stringify(creationResult.body)).toBeTruthy();
      const appointment = creationResult.body?.data?.appointment;
      if (!appointment?.id) {
        throw new Error(`Appointment creation did not return an id: ${JSON.stringify(creationResult.body)}`);
      }

      const persistedStart = await getBrowserStartParts(page, appointment.startTime);
      return {
        id: appointment.id,
        dateString: persistedStart.dateString,
        time: persistedStart.time,
        startTime: appointment.startTime,
      };
    } finally {
      await requestContext.dispose();
    }
  }

  const maxAttempts = options?.technicianId ? 1 : 10;
  let attemptedSlots = 0;
  let lastFailure: { status: number; body: unknown } | null = null;
  const requestContext = await createAuthenticatedRequestContext(page);
  const selectedAddOnsParam = serializeSelectedAddOns(selectedAddOns);

  try {
    for (let offset = 1; offset <= 21; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      date.setHours(0, 0, 0, 0);

      const params = new URLSearchParams({
        date: isoDate(date),
        salonSlug: e2eConfig.salonSlug,
      });

      if (options?.baseServiceId) {
        params.set('baseServiceId', options.baseServiceId);
        if (options.locationId) {
          params.set('locationId', options.locationId);
        }
        if (selectedAddOnsParam) {
          params.set('selectedAddOns', selectedAddOnsParam);
        }
      } else {
        params.set('durationMinutes', String(e2eConfig.serviceDurationMinutes));
        params.set('serviceIds', serviceIds.join(','));
      }

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
            serviceIds: options?.baseServiceId ? undefined : serviceIds,
            baseServiceId: options?.baseServiceId ?? undefined,
            selectedAddOns,
            technicianId: options?.technicianId ?? null,
            clientName: options?.clientName ?? undefined,
            clientPhone: options?.clientPhone ?? undefined,
            locationId: options?.locationId ?? undefined,
            startTime: startTime.toISOString(),
          },
        );

        if (creationResult.ok) {
          const appointment = creationResult.body?.data?.appointment;
          if (!appointment?.id) {
            throw new Error(`Appointment creation did not return an id: ${JSON.stringify(creationResult.body)}`);
          }

          const persistedStart = await getBrowserStartParts(page, appointment.startTime);
          return {
            id: appointment.id,
            dateString: persistedStart.dateString,
            time: persistedStart.time,
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

export async function cancelAppointmentViaApi(appointmentId: string) {
  const requestContext = await playwrightRequest.newContext({
    baseURL: e2eBaseUrl,
    storageState: authStatePaths.staff,
  });

  try {
    const cancelResult = await patchJson(
      requestContext,
      `/api/appointments/${appointmentId}/cancel`,
      { cancelReason: 'client_request' },
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

export async function selectBookableSlotFromApi(
  page: Page,
  options?: {
    technicianId?: string | null;
    daysToScan?: number;
    baseServiceId?: string | null;
    locationId?: string | null;
    selectedAddOns?: string | null;
  },
) {
  const slot = await findBookableSlot(page, {
    technicianId: options?.technicianId,
    daysToScan: options?.daysToScan,
    baseServiceId: options?.baseServiceId,
    locationId: options?.locationId,
    selectedAddOnsParam: options?.selectedAddOns ?? null,
  });
  const targetDayTestId = `calendar-day-${slot.dateString}`;
  const confirmUrlPattern = /\/(?:en\/)?[^/]+\/book\/confirm(?:\?|$)|\/(?:en\/)?book\/confirm(?:\?|$)/;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const dayButton = page.getByTestId(targetDayTestId);
    if (await dayButton.isVisible().catch(() => false)) {
      const dayEnabled = await dayButton.isEnabled().catch(() => false);
      if (dayEnabled) {
        const availabilityResponsePromise = page.waitForResponse(response => (
          availabilityRequestMatches({
            url: response.url(),
            dateString: slot.dateString,
            technicianId: options?.technicianId ?? null,
            baseServiceId: options?.baseServiceId ?? null,
            locationId: options?.locationId ?? null,
            selectedAddOns: options?.selectedAddOns ?? null,
          })
        ), { timeout: 20_000 });

        await dayButton.click();

        const availabilityResponse = await availabilityResponsePromise;
        expect(availabilityResponse.ok(), `Availability request failed for ${slot.dateString}`).toBeTruthy();
      }

      const loadingCard = page.getByText('Checking live availability');
      await loadingCard.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {});
      await expect(dayButton).toBeDisabled({ timeout: 20_000 });

      const slotButton = page.getByTestId(`time-slot-${slot.time}`);
      await expect(slotButton).toBeVisible({ timeout: 20_000 });
      await expect(slotButton).toBeEnabled({ timeout: 20_000 });
      await Promise.all([
        page.waitForURL(confirmUrlPattern, { timeout: 20_000 }),
        slotButton.click(),
      ]);
      return slot;
    }

    const nextMonthButton = page.getByRole('button', { name: /next month/i });
    if (!await nextMonthButton.isVisible().catch(() => false)) {
      break;
    }

    await nextMonthButton.click();
  }

  throw new Error(`Could not select API-discovered slot ${slot.dateString} ${slot.time} in the booking calendar.`);
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
