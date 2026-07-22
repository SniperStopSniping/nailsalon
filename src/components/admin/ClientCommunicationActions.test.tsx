import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientCommunicationActions } from './ClientCommunicationActions';

const fetchMock = vi.fn();
let retentionData: Record<string, unknown>;
let retentionSettings: Record<string, unknown>;
let smartReminderResponse: Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const upcomingAppointment = {
  id: 'appt_1',
  startTime: '2026-07-18T18:00:00.000Z',
  endTime: '2026-07-18T19:30:00.000Z',
  totalPrice: 6500,
  technician: { name: 'Daniela' },
  services: [{ name: 'Builder Gel Overlay' }],
};

function renderActions(overrides: Partial<React.ComponentProps<typeof ClientCommunicationActions>> = {}) {
  const onOpenNativeUrl = vi.fn();
  render(
    <ClientCommunicationActions
      salonSlug="isla"
      salonName="Isla Nail Studio"
      client={{ id: 'client_1', fullName: 'Ava Nguyen', phone: '4165551234' }}
      upcomingAppointment={upcomingAppointment}
      lastCompletedAppointment={{ ...upcomingAppointment, id: 'appt_old' }}
      completedAppointmentCount={1}
      hasGoogleReview={false}
      onBookAppointment={vi.fn()}
      onOpenNativeUrl={onOpenNativeUrl}
      {...overrides}
    />,
  );
  return { onOpenNativeUrl };
}

describe('ClientCommunicationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    retentionData = { retention: [], appointmentReminders: [], history: [] };
    retentionSettings = {
      defaultRebookDays: 21,
      reminderLeadHours: 24,
      googleReviewUrl: 'https://g.page/r/isla/review',
      parkingInstructions: 'Use the lot behind the salon.',
    };
    smartReminderResponse = {
      mode: 'manual',
      sent: false,
      reason: 'TWILIO_UNAVAILABLE',
      phone: '4165551234',
      body: 'Hi Ava, appointment reminder: https://isla.test/en/isla/manage/secure-token',
    };
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/admin/retention/settings')) {
        return Promise.resolve(jsonResponse({
          data: {
            settings: retentionSettings,
          },
        }));
      }
      if (url.startsWith('/api/admin/location')) {
        return Promise.resolve(jsonResponse({
          data: {
            location: {
              address: '123 Queen St W',
              city: 'Toronto',
              state: 'ON',
              zipCode: 'M5H 2M9',
            },
          },
        }));
      }
      if (url.startsWith('/api/admin/today')) {
        return Promise.resolve(jsonResponse({
          data: {
            timeZone: 'America/Toronto',
            links: { bookingUrl: 'https://isla.test/en/isla/book' },
          },
        }));
      }
      if (url.includes('/send-reminder')) {
        return Promise.resolve(jsonResponse({
          data: smartReminderResponse,
        }));
      }
      if (url.includes('/manage-link')) {
        return Promise.resolve(jsonResponse({
          data: { manageUrl: 'https://isla.test/en/isla/manage/secure-token' },
        }));
      }
      if (url.includes('/review-followup') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          data: { action: 'already_reviewed', clientHasGoogleReview: true },
        }));
      }
      if (url === '/api/admin/retention/campaigns' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          data: {
            campaign: {
              id: 'campaign_1',
              stage: 'promo_6w',
              expiresAt: '2026-08-01T00:00:00.000Z',
              bookingUrl: 'https://isla.test/en/isla/book?campaign=secure-token',
            },
          },
        }));
      }
      if (url === '/api/admin/retention' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { communication: { id: 'comm_1' } } }));
      }
      if (url.startsWith('/api/admin/retention?')) {
        return Promise.resolve(jsonResponse({ data: retentionData }));
      }
      return Promise.resolve(jsonResponse({ data: {} }));
    });
  });

  it('exposes all client actions and keeps Happy and Google review side by side', async () => {
    renderActions();

    for (const label of [
      'Call',
      'Text',
      'Rebook',
      'Send reminder',
      'Appointment details',
      'Directions',
      'Happy?',
      'Google review',
      'Book for client',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Google review' })).toBeEnabled();
    });
  });

  it('opens an editable generic iPhone message and asks for an honest result', async () => {
    const { onOpenNativeUrl } = renderActions();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole('button', { name: 'Text' }));

    expect(onOpenNativeUrl).toHaveBeenCalledTimes(1);

    const href = String(onOpenNativeUrl.mock.calls[0]?.[0]);

    expect(href).toMatch(/^sms:4165551234[?&]body=/);
    expect(decodeURIComponent(href.split('body=')[1]!)).toContain('Hi Ava');
    expect(screen.getByRole('dialog', { name: 'Confirm text status' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as sent' }));
    await waitFor(() => {
      const retentionCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/admin/retention');

      expect(retentionCalls).toHaveLength(2);
      expect(JSON.parse(String(retentionCalls[1]?.[1]?.body))).toMatchObject({
        kind: 'generic_text',
        status: 'marked_sent',
        clientId: 'client_1',
      });
    });

    expect(screen.queryByRole('dialog', { name: 'Confirm text status' })).not.toBeInTheDocument();
  });

  it('uses the smart reminder endpoint and opens its manual draft when Twilio is unavailable', async () => {
    const { onOpenNativeUrl } = renderActions();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/appointments/appt_1/send-reminder?salonSlug=isla',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: false }),
        },
      );
      expect(onOpenNativeUrl).toHaveBeenCalledTimes(1);
    });
    const href = String(onOpenNativeUrl.mock.calls[0]?.[0]);

    expect(decodeURIComponent(href.split('body=')[1]!)).toContain(
      'https://isla.test/en/isla/manage/secure-token',
    );
    expect(screen.getByRole('button', { name: 'Snooze 3 hours' })).toBeInTheDocument();

    await waitFor(() => {
      const preparedCall = fetchMock.mock.calls.find(([url, init]) => (
        url === '/api/admin/retention'
        && JSON.parse(String(init?.body)).kind === 'reminder'
      ));

      expect(JSON.parse(String(preparedCall?.[1]?.body))).toMatchObject({
        appointmentId: 'appt_1',
        status: 'prepared',
      });
    });
  });

  it('sends the reminder automatically when the salon SMS integration is ready', async () => {
    smartReminderResponse = {
      mode: 'automatic',
      sent: true,
      sentAt: '2026-07-18T12:00:00.000Z',
    };
    const { onOpenNativeUrl } = renderActions();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Reminder sent automatically');
    expect(onOpenNativeUrl).not.toHaveBeenCalled();
  });

  it('does not add another history entry when a duplicate reminder is suppressed', async () => {
    smartReminderResponse = {
      mode: 'automatic',
      sent: true,
      reason: 'DUPLICATE_SUPPRESSED',
    };
    const { onOpenNativeUrl } = renderActions();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'A reminder was just sent, so the duplicate was skipped.',
    );
    expect(onOpenNativeUrl).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url, init]) => (
      url === '/api/admin/retention' && init?.method === 'POST'
    ))).toHaveLength(0);
  });

  it('uses the upcoming appointment secondary location for the Directions draft', async () => {
    const { onOpenNativeUrl } = renderActions({
      upcomingAppointment: {
        ...upcomingAppointment,
        location: {
          id: 'loc_secondary',
          name: 'Yorkville Studio',
          address: '88 Cumberland St',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5R 1A3',
        },
      },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole('button', { name: 'Directions' }));

    const href = String(onOpenNativeUrl.mock.calls[0]?.[0]);
    const body = decodeURIComponent(href.split('body=')[1]!);

    expect(body).toContain('88 Cumberland St, Toronto, ON, M5R 1A3');
    expect(body).toContain(
      'destination=88%20Cumberland%20St%2C%20Toronto%2C%20ON%2C%20M5R%201A3',
    );
    expect(body).not.toContain('123 Queen St W');

    fireEvent.click(screen.getByRole('button', { name: 'Not sent' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm text status' })).not.toBeInTheDocument();
    });
  });

  it('falls back to the primary salon location when the appointment has no address', async () => {
    const { onOpenNativeUrl } = renderActions({
      upcomingAppointment: {
        ...upcomingAppointment,
        location: {
          id: 'loc_secondary',
          name: 'Pop-up Studio',
          address: null,
          city: null,
          state: null,
          zipCode: null,
        },
      },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole('button', { name: 'Directions' }));

    const href = String(onOpenNativeUrl.mock.calls[0]?.[0]);
    const body = decodeURIComponent(href.split('body=')[1]!);

    expect(body).toContain('123 Queen St W, Toronto, ON, M5H 2M9');

    fireEvent.click(screen.getByRole('button', { name: 'Not sent' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm text status' })).not.toBeInTheDocument();
    });
  });

  it('snoozes a due appointment reminder for the reminder-specific window', async () => {
    retentionData = {
      retention: [],
      appointmentReminders: [{
        appointmentId: 'appt_1',
        clientId: 'client_1',
        startTime: upcomingAppointment.startTime,
      }],
      history: [],
    };
    renderActions();

    expect(await screen.findByTestId('client-reminder-alert')).toHaveTextContent('reminder is due');

    fireEvent.click(screen.getByRole('button', { name: 'Snooze 3 hours' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => (
        url === '/api/admin/retention'
        && JSON.parse(String(init?.body)).status === 'snoozed'
      ));
      const requestBody = JSON.parse(String(call?.[1]?.body));

      expect(requestBody).toMatchObject({
        kind: 'reminder',
        appointmentId: 'appt_1',
        status: 'snoozed',
        snoozeHours: 3,
      });
      expect(requestBody).not.toHaveProperty('snoozeDays');
    });

    expect(screen.queryByTestId('client-reminder-alert')).not.toBeInTheDocument();
  });

  it('allows a due appointment reminder to be skipped', async () => {
    retentionData = {
      retention: [],
      appointmentReminders: [{
        appointmentId: 'appt_1',
        clientId: 'client_1',
        startTime: upcomingAppointment.startTime,
      }],
      history: [],
    };
    renderActions();

    expect(await screen.findByTestId('client-reminder-alert')).toHaveTextContent('reminder is due');

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => (
        url === '/api/admin/retention'
        && JSON.parse(String(init?.body)).status === 'dismissed'
      ));

      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        kind: 'reminder',
        appointmentId: 'appt_1',
        status: 'dismissed',
      });
    });

    expect(screen.queryByTestId('client-reminder-alert')).not.toBeInTheDocument();
  });

  it('disables review outreach until there is a completed appointment', async () => {
    renderActions({ completedAppointmentCount: 0 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    expect(screen.getByRole('button', { name: 'Happy?' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Google review' })).toBeDisabled();
  });

  it('suppresses future review requests when the tech marks a client already reviewed', async () => {
    renderActions();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Google review' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Client already reviewed? Mark it' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/appointments/appt_old/review-followup?salonSlug=isla',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(screen.getByRole('button', { name: 'Google review' })).toBeDisabled();
    });

    expect(screen.getByText(/review already recorded/i)).toBeInTheDocument();
  });

  it('prepares a secure configured win-back offer and shows honest history', async () => {
    retentionSettings = {
      ...retentionSettings,
      sixWeekPromotion: {
        enabled: true,
        name: 'We miss you',
        discountType: 'percent',
        value: 10,
        eligibleServiceIds: [],
        expiryDays: 14,
        code: 'WELCOME10',
        messageTemplate: 'Hi {firstName}, enjoy {offer} at {salonName} by {expiry}: {bookingLink}',
        singleUse: true,
      },
    };
    retentionData = {
      retention: [{ clientId: 'client_1', stage: 'promo_6w' }],
      appointmentReminders: [],
      history: [{
        id: 'history_1',
        appointmentId: null,
        kind: 'rebook',
        status: 'marked_sent',
        snoozedUntil: null,
        createdAt: '2026-07-01T12:00:00.000Z',
        updatedAt: '2026-07-01T12:00:00.000Z',
      }],
    };
    const { onOpenNativeUrl } = renderActions();

    const offerButton = await screen.findByRole('button', { name: 'Send 6-week offer' });

    expect(screen.getByRole('button', { name: 'Snooze 7 days' })).toBeInTheDocument();

    fireEvent.click(offerButton);

    await waitFor(() => expect(onOpenNativeUrl).toHaveBeenCalledTimes(1));
    const href = String(onOpenNativeUrl.mock.calls[0]?.[0]);
    const body = decodeURIComponent(href.split('body=')[1]!);

    expect(body).toContain('10% off');
    expect(body).toContain('campaign=secure-token');
    expect(body).toContain('Use code WELCOME10');
    expect(screen.getByTestId('client-retention-alert')).toHaveTextContent('Six-week win-back');

    fireEvent.click(screen.getByText(/^Communication history/));

    expect(screen.getByText('Rebook request')).toBeInTheDocument();
    expect(screen.getByText('Marked sent')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/retention/campaigns', expect.objectContaining({
      method: 'POST',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Mark as sent' }));
    await waitFor(() => {
      expect(screen.queryByTestId('client-retention-alert')).not.toBeInTheDocument();
    });
  });

  it('opens Promotion Settings when the due win-back offer is not configured', async () => {
    retentionData = {
      retention: [{ clientId: 'client_1', stage: 'promo_8w' }],
      appointmentReminders: [],
      history: [],
    };
    const onOpenPromotionSettings = vi.fn();

    renderActions({ onOpenPromotionSettings });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Send 8-week offer' }),
    );

    expect(onOpenPromotionSettings).toHaveBeenCalledWith('promo_8w');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/admin/retention/campaigns',
      expect.anything(),
    );
    expect(
      screen.queryByText('Configure and enable this offer in Promotion Settings first.'),
    ).not.toBeInTheDocument();
  });
});
