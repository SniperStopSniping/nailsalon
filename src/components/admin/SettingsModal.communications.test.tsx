import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsModal } from './SettingsModal';

const { fetchMock, refreshMock, capability } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
  capability: { smsChannelAvailable: true, sms: null as Record<string, unknown> | null },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: refreshMock,
  }),
  useParams: () => ({ locale: 'en' }),
  // Settings sub-views are URL-backed (AG-w2-settings-integrations-10).
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: null }),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children));
  return {
    motion: new Proxy({}, { get: (_, tag: string) => makeMotionTag(tag) }),
  };
});

vi.mock('./PageThemesSettings', () => ({
  PageThemesSettings: () => <div data-testid="page-themes-settings" />,
}));

vi.mock('./BookingFlowEditor', () => ({
  BookingFlowEditor: () => <div data-testid="booking-flow-editor" />,
}));

const settingsPayload = () => ({
  reviewsEnabled: true,
  rewardsEnabled: true,
  bookingConfig: {
    bufferMinutes: 10,
    slotIntervalMinutes: 15,
    currency: 'CAD',
    timezone: 'America/Toronto',
    introPriceDefaultLabel: null,
    firstVisitDiscountEnabled: false,
  },
  bookingNotifications: {
    newBooking: { technicianEnabled: true, ownerEnabled: false, technicianChannel: 'sms', ownerChannel: 'both' },
    appointmentCancelled: { technicianEnabled: true, ownerEnabled: false, technicianChannel: 'sms', ownerChannel: 'both' },
  },
  communications: {
    sms: { enabled: false },
    email: { enabled: true },
    killSwitch: false,
    quietHours: { enabled: true, start: '21:00', end: '09:00' },
    reminders: {
      rules: [{ id: 'crule_default_24h', offsetMinutes: 1440, channels: 'both', enabled: true }],
    },
    events: {},
  },
  ownerPhonePresent: true,
  ownerEmailPresent: true,
  smsChannelAvailable: capability.smsChannelAvailable,
  sms: capability.sms,
  emailChannelAvailable: true,
  effectivePoints: { welcomeBonus: 0, profileCompletion: 0, referralReferee: 0, referralReferrer: 0 },
  defaults: { welcomeBonus: 0, profileCompletion: 0, referralReferee: 0, referralReferrer: 0 },
  billingMode: 'NONE',
  subscriptionStatus: null,
});

describe('SettingsModal communications view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    capability.smsChannelAvailable = true;
    capability.sms = null;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/salon/settings?salonSlug=salon-a')) {
        return Promise.resolve(new Response(JSON.stringify(settingsPayload()), { status: 200 }));
      }
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(settingsPayload()), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    });
  });

  async function openCommunications() {
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);
    const row = await screen.findByText('Client texts & reminders');
    fireEvent.click(row);
    await screen.findByText('Appointment reminders');
  }

  it('opens from the index and shows the loaded default rule and quiet hours', async () => {
    await openCommunications();

    expect(screen.getByLabelText('Reminder 1 timing')).toHaveValue('1440');
    expect(screen.getByLabelText('Reminder 1 channel')).toHaveValue('both');
    expect(screen.getByLabelText('Quiet hours start')).toHaveValue('21:00');
    expect(screen.getByLabelText('Quiet hours end')).toHaveValue('09:00');
    // Save is disabled until something changes.
    expect(screen.getByRole('button', { name: /save communication settings/i })).toBeDisabled();
  });

  it.each([42, null])('describes Luster SMS credits with a balance of %s', async (availableCredits) => {
    capability.sms = {
      providerReady: availableCredits !== null,
      senderMode: availableCredits === null ? 'disabled' : 'shared_luster',
      senderLabel: availableCredits === null ? 'Retired texting connection' : 'Luster shared texting number',
      phoneNumber: null,
      blockingReason: availableCredits === null ? 'byo_retired' : null,
      detail: availableCredits === null
        ? 'Luster texts use SMS credits. This salon has a retired texting connection. Contact support before enabling Luster texting.'
        : 'Texts send through Luster.',
      smsEnabled: true,
      automaticEnabled: availableCredits !== null,
      manualAvailable: availableCredits !== null,
      remindersEnabled: availableCredits !== null,
      quietHours: { enabled: true, start: '21:00', end: '09:00' },
      availableCredits,
      workerConfigured: true,
    };
    await openCommunications();

    expect(screen.getByText(/Text messages sent from Luster use Luster SMS credits\./)).toBeInTheDocument();
    expect(screen.getByText(availableCredits === null
      ? 'Luster SMS credit balance is unavailable. Contact support.'
      : '42 SMS credits available. See Usage for details.')).toBeInTheDocument();
    expect(screen.queryByText(/connected Twilio account/i)).not.toBeInTheDocument();

    if (availableCredits === null) {
      expect(screen.getByText(/Contact support before enabling Luster texting\./)).toBeInTheDocument();
    }
  });

  it('editing marks the view dirty: leaving warns instead of silently discarding', async () => {
    await openCommunications();
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '22:00' } });

    expect(screen.getByRole('button', { name: /save communication settings/i })).toBeEnabled();

    // Back-navigation with unsaved changes shows the confirmation banner —
    // this is the viewDirty entry the Partial<Record<...>> type cannot enforce.
    const backButton = screen.getAllByRole('button').find(button => button.getAttribute('aria-label') === 'Back')
      ?? screen.getByText('Settings');
    fireEvent.click(backButton);
    await waitFor(() => {
      expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
    });
  });

  it('keeps saved SMS preferences editable when provider setup is incomplete', async () => {
    capability.smsChannelAvailable = false;
    await openCommunications();
    const channel = screen.getByLabelText('Reminder 1 channel') as HTMLSelectElement;
    const options = Array.from(channel.options).map(option => ({
      text: option.text,
      disabled: option.disabled,
    }));

    expect(options).toContainEqual({ text: 'Text (Unavailable)', disabled: false });
    expect(options).toContainEqual({ text: 'Email & text (Unavailable)', disabled: false });
    expect(screen.getByRole('checkbox', { name: /text messages to clients/i })).toBeEnabled();
    expect(screen.getByText('(Unavailable)')).toBeInTheDocument();
  });

  it('saves the whole rules list under the communications namespace', async () => {
    await openCommunications();
    fireEvent.click(screen.getByText('+ Add reminder'));
    fireEvent.click(screen.getByRole('button', { name: /save communication settings/i }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');

      expect(patch).toBeDefined();

      const body = JSON.parse(String((patch![1] as RequestInit).body));

      expect(body.communications.reminders.rules).toHaveLength(2);
      expect(body.communications.reminders.rules[0].id).toBe('crule_default_24h');
      expect(body.communications.sms).toEqual({ enabled: false });
      expect(body.communications.quietHours).toEqual({ enabled: true, start: '21:00', end: '09:00' });
    });
  });

  it('adds a third reminder at a different time and persists an emergency pause', async () => {
    await openCommunications();
    fireEvent.click(screen.getByText('+ Add reminder'));
    fireEvent.click(screen.getByText('+ Add reminder'));

    expect(screen.getByLabelText('Reminder 3 timing')).toHaveValue('240');

    fireEvent.click(screen.getByRole('checkbox', { name: /pause all communications/i }));
    fireEvent.click(screen.getByRole('button', { name: /save communication settings/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');

      expect(JSON.parse(String((patch![1] as RequestInit).body)).communications.killSwitch).toBe(true);
    });
  });

  it('explains duplicate reminder times before attempting a save', async () => {
    await openCommunications();
    fireEvent.click(screen.getByText('+ Add reminder'));
    fireEvent.change(screen.getByLabelText('Reminder 2 timing'), { target: { value: '1440' } });
    fireEvent.click(screen.getByRole('button', { name: /save communication settings/i }));

    expect(await screen.findByText('Choose a different time for each enabled reminder.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
  });

  it('explains invalid quiet hours before attempting a save', async () => {
    await openCommunications();
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '09:00' } });
    fireEvent.click(screen.getByRole('button', { name: /save communication settings/i }));

    expect(await screen.findByText('Choose different start and end times for quiet hours.')).toBeInTheDocument();
  });
});
