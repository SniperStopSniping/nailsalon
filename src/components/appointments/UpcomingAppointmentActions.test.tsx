import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppointmentManageDetail } from '@/libs/appointmentManage';

import { UpcomingAppointmentActions } from './UpcomingAppointmentActions';

const fetchMock = vi.fn();
let reminderDue: boolean;
let reminderResponse: Response;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseDetail: AppointmentManageDetail = {
  appointment: {
    id: 'appt_1',
    salonId: 'salon_1',
    salonSlug: 'salon-a',
    salonName: 'Salon A',
    timeZone: 'America/Toronto',
    parkingInstructions: 'Use the lot behind the salon.',
    clientName: 'Avery',
    clientPhone: '4165551234',
    technicianId: 'tech_1',
    locationId: 'loc_1',
    locationName: 'Front St',
    status: 'confirmed',
    startTime: '2026-08-29T15:00:00.000Z',
    endTime: '2026-08-29T16:00:00.000Z',
    totalPrice: 4500,
    totalDurationMinutes: 60,
    bufferMinutes: 10,
    slotIntervalMinutes: 15,
    isLocked: false,
    lockedAt: null,
    paymentStatus: 'pending',
    baseServiceId: 'svc_1',
    baseServiceName: 'Gel Manicure',
    discountType: null,
    discountAmountCents: 0,
    notes: null,
    techNotes: null,
  },
  client: {
    id: 'client_1',
    notes: null,
    sensitivities: null,
    nailPreferences: null,
  },
  location: {
    id: 'loc_1',
    name: 'Front St',
    address: '123 Front St W',
    city: 'Toronto',
    state: 'ON',
    zipCode: 'M5J 2M2',
  },
  services: [{
    id: 'svc_1',
    name: 'Gel Manicure',
    category: 'manicure',
    priceAtBooking: 4500,
    durationAtBooking: 60,
    isBaseService: true,
  }],
  addOns: [],
  serviceOptions: [{
    id: 'svc_1',
    name: 'Gel Manicure',
    category: 'manicure',
    priceCents: 4500,
    durationMinutes: 60,
  }],
  technicianOptions: [{ id: 'tech_1', name: 'Taylor' }],
  permissions: {
    canMove: true,
    canChangeService: true,
    canCancel: true,
    canMarkCompleted: true,
    canStart: true,
    canConfirm: false,
    canMarkNoShow: true,
    canReassignTechnician: false,
  },
  warnings: [],
  communications: [],
};

function renderActions(
  overrides: Partial<React.ComponentProps<typeof UpcomingAppointmentActions>> = {},
) {
  const onChangeAppointment = vi.fn();
  const onCancelAppointment = vi.fn();
  const onReminderSent = vi.fn();
  const onOpenNativeUrl = vi.fn();

  const view = render(
    <UpcomingAppointmentActions
      detail={baseDetail}
      saving={false}
      onChangeAppointment={onChangeAppointment}
      onCancelAppointment={onCancelAppointment}
      onReminderSent={onReminderSent}
      onOpenNativeUrl={onOpenNativeUrl}
      {...overrides}
    />,
  );

  return {
    ...view,
    onChangeAppointment,
    onCancelAppointment,
    onReminderSent,
    onOpenNativeUrl,
  };
}

function findReminderRequest() {
  return fetchMock.mock.calls.find(([input]) => String(input).includes('/send-reminder'));
}

describe('UpcomingAppointmentActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reminderDue = false;
    reminderResponse = jsonResponse({
      data: {
        mode: 'automatic',
        sent: true,
        sentAt: '2026-07-22T18:00:00.000Z',
      },
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/communication') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(jsonResponse({
          data: { reminderDue, history: [] },
        }));
      }
      if (url.includes('/communication') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          data: { communication: { id: 'comm_1' }, tracked: true },
        }));
      }
      if (url.includes('/send-reminder') && init?.method === 'POST') {
        return Promise.resolve(reminderResponse);
      }

      return Promise.resolve(jsonResponse({ data: {} }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends an eligible reminder automatically and refreshes appointment details', async () => {
    const { onReminderSent, onOpenNativeUrl } = renderActions();

    fireEvent.click(screen.getByTestId('appointment-send-reminder'));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Reminder sent automatically from your salon number.',
    );
    expect(onReminderSent).toHaveBeenCalledTimes(1);
    expect(onOpenNativeUrl).not.toHaveBeenCalled();

    const request = findReminderRequest();

    expect(request?.[0]).toBe('/api/appointments/appt_1/send-reminder?salonSlug=salon-a');
    expect(request?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ force: false });
  });

  it('opens the server-provided SMS draft when automatic delivery is known to be unavailable', async () => {
    reminderResponse = jsonResponse({
      data: {
        mode: 'manual',
        sent: false,
        reason: 'SMS_NOT_CONFIGURED',
        phone: '4165551234',
        body: 'Hi Avery, this is your appointment reminder.',
      },
    });
    const { onOpenNativeUrl } = renderActions();

    fireEvent.click(screen.getByTestId('appointment-send-reminder'));

    await waitFor(() => expect(onOpenNativeUrl).toHaveBeenCalledTimes(1));

    const href = String(onOpenNativeUrl.mock.calls[0]?.[0]);

    expect(href).toMatch(/^sms:4165551234[?&]body=/);
    expect(decodeURIComponent(href.split('body=')[1]!)).toBe(
      'Hi Avery, this is your appointment reminder.',
    );
    expect(screen.getByRole('dialog', { name: 'Confirm text status' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as sent' }));

    expect(await screen.findByRole('button', { name: 'Resend reminder' })).toBeInTheDocument();
    expect(screen.getByTestId('appointment-reminder-last-sent')).toHaveTextContent('via SMS draft');
  });

  it('requires confirmation before resending and sends the confirmed request with force enabled', async () => {
    renderActions({
      detail: {
        ...baseDetail,
        communications: [{
          channel: 'sms',
          purpose: 'appointment_reminder_manual',
          status: 'sent',
          errorCode: null,
          updatedAt: '2026-07-22T17:00:00.000Z',
        }],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resend reminder' }));

    expect(findReminderRequest()).toBeUndefined();
    expect(screen.getByRole('alert')).toHaveTextContent('Send another reminder?');

    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));

    await waitFor(() => expect(findReminderRequest()).toBeDefined());

    expect(JSON.parse(String(findReminderRequest()?.[1]?.body))).toEqual({ force: true });
  });

  it('routes change and cancel actions to their callbacks', () => {
    const { onChangeAppointment, onCancelAppointment } = renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Change appointment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));

    expect(onChangeAppointment).toHaveBeenCalledTimes(1);
    expect(onCancelAppointment).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Snooze 3 hours', 'snoozed', 3],
    ['Skip', 'dismissed', undefined],
  ] as const)('records a due reminder action: %s', async (buttonName, status, snoozeHours) => {
    reminderDue = true;
    renderActions();

    expect(await screen.findByTestId('appointment-reminder-due')).toHaveTextContent(
      'Appointment reminder is due',
    );

    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([input, init]) => (
        String(input).includes('/api/appointments/appt_1/communication')
        && init?.method === 'POST'
        && JSON.parse(String(init?.body)).status === status
      ));
      const body = JSON.parse(String(request?.[1]?.body));

      expect(body).toMatchObject({
        kind: 'reminder',
        status,
      });

      if (snoozeHours) {
        expect(body.snoozeHours).toBe(snoozeHours);
      } else {
        expect(body).not.toHaveProperty('snoozeHours');
      }
    });

    expect(screen.queryByTestId('appointment-reminder-due')).not.toBeInTheDocument();
  });

  it('shows Directions only when the appointment has a usable location', () => {
    const { unmount, onOpenNativeUrl } = renderActions();

    expect(screen.getByRole('button', { name: 'Directions' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Directions' }));

    expect(decodeURIComponent(String(onOpenNativeUrl.mock.calls[0]?.[0]).split('body=')[1]!))
      .toContain('Parking: Use the lot behind the salon.');

    unmount();
    renderActions({
      detail: {
        ...baseDetail,
        appointment: {
          ...baseDetail.appointment,
          parkingInstructions: null,
        },
        location: null,
      },
    });

    expect(screen.queryByRole('button', { name: 'Directions' })).not.toBeInTheDocument();
  });
});
