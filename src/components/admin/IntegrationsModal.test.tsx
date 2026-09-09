import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsModal } from './IntegrationsModal';

type HealthOverrides = {
  google?: Record<string, unknown>;
  twilio?: Record<string, unknown>;
  sms?: Record<string, unknown>;
  availability?: Record<string, unknown>;
  latestSmsDeliveryError?: Record<string, unknown> | null;
};

function healthPayload(overrides: HealthOverrides = {}) {
  return {
    data: {
      availability: {
        google: true,
        twilio: true,
        twilioConnectOnboarding: true,
        email: true,
        photos: true,
        ...overrides.availability,
      },
      google: {
        status: 'disconnected',
        readiness: 'not_connected',
        email: null,
        lastError: null,
        inboundSyncEnabled: false,
        inboundSyncedAt: null,
        inboundSyncError: null,
        blockingCalendarCount: 0,
        ...overrides.google,
      },
      twilio: {
        status: 'disconnected',
        phoneNumber: null,
        lastError: null,
        ...overrides.twilio,
      },
      sms: overrides.sms,
      latestSmsDeliveryError: overrides.latestSmsDeliveryError ?? null,
    },
  };
}

const fetchMock = vi.fn();

function readySms(overrides: Record<string, unknown> = {}) {
  return {
    providerReady: true,
    senderMode: 'shared_luster',
    senderLabel: 'Luster shared texting number',
    phoneNumber: null,
    blockingReason: null,
    detail: 'Texts send through Luster.',
    smsEnabled: true,
    automaticEnabled: true,
    manualAvailable: true,
    remindersEnabled: true,
    quietHours: { enabled: true, start: '21:00', end: '09:00' },
    availableCredits: 42,
    workerConfigured: true,
    ...overrides,
  };
}

function mockEndpoints(options: {
  health?: HealthOverrides;
  smsReminders?: 'ENABLED' | 'MODULE_DISABLED' | 'UPGRADE_REQUIRED';
  onDisconnect?: () => void;
} = {}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/integrations/health')) {
      return new Response(JSON.stringify(healthPayload(options.health)), { status: 200 });
    }
    if (url.startsWith('/api/admin/settings/modules')) {
      return new Response(
        JSON.stringify({
          data: { moduleReasons: { smsReminders: options.smsReminders ?? 'ENABLED' } },
        }),
        { status: 200 },
      );
    }
    if (url === '/api/integrations/google/disconnect' && init?.method === 'POST') {
      options.onDisconnect?.();
      return new Response(JSON.stringify({ data: { disconnected: true } }), { status: 200 });
    }
    if (url.startsWith('/api/integrations/google/calendars')) {
      return new Response(
        JSON.stringify({
          data: {
            calendars: [
              { id: 'cal_1', summary: 'Main calendar', primary: true, accessRole: 'owner' },
            ],
            selection: { destinationCalendarId: 'cal_1', busyCalendarIds: ['cal_1'] },
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
}

function stubUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value,
    configurable: true,
  });
}

const originalUserAgent = window.navigator.userAgent;

describe('IntegrationsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    stubUserAgent(originalUserAgent);
    vi.unstubAllGlobals();
  });

  it('does not claim Luster texting is ready without a configured sender', async () => {
    mockEndpoints({ health: { twilio: { status: 'disconnected' } } });

    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" />);

    await waitFor(() => {
      expect(screen.getByTestId('integration-row-google')).toHaveTextContent('Not connected');
    });

    expect(screen.getByTestId('integration-row-texting')).toHaveTextContent('Not available yet');

    expect(screen.getByTestId('integration-row-email')).toHaveTextContent('Ready');
    // No payments row: no client-payment integration exists.
    expect(screen.queryByText(/payments/i)).toBeInTheDocument(); // informational footnote only
    expect(screen.queryByTestId('integration-row-payments')).not.toBeInTheDocument();
  });

  it('reports Google as Ready only when readiness is ready', async () => {
    mockEndpoints({
      health: {
        google: { status: 'active', readiness: 'setup_incomplete', blockingCalendarCount: 0 },
      },
    });

    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" />);

    await waitFor(() => {
      expect(screen.getByTestId('integration-row-google')).toHaveTextContent('Setup incomplete');
    });
  });

  it('distinguishes the phone composer from unavailable Luster texting', async () => {
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    mockEndpoints({ health: { twilio: { status: 'disconnected' } } });

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Not available yet');
    });

    expect(screen.getByTestId('manual-texting-section')).toHaveTextContent('Not available yet');
    expect(screen.getByTestId('native-texting-section')).toHaveTextContent(/own mobile number and mobile plan/i);
    expect(screen.getByTestId('native-texting-section')).toHaveTextContent(/do not use Luster SMS credits/i);
    expect(screen.queryByText('Authorize Twilio')).not.toBeInTheDocument();
  });

  it('flags manual texting as unsupported on a desktop browser', async () => {
    stubUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    mockEndpoints({});

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('native-texting-section')).toHaveTextContent(
        'Use your phone',
      );
    });
  });

  it('does not report automatic texting Ready while automatic messages are paused', async () => {
    mockEndpoints({
      health: { sms: readySms({ automaticEnabled: false, remindersEnabled: false, detail: 'Automatic texts are paused in Settings.' }) },
      smsReminders: 'MODULE_DISABLED',
    });

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Paused');
    });

    expect(screen.getByTestId('automatic-texting-section')).not.toHaveTextContent(/^Ready$/);
  });

  it('reports automatic texting Ready from canonical Luster SMS readiness', async () => {
    mockEndpoints({
      health: { sms: readySms() },
      smsReminders: 'ENABLED',
    });

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Ready');
    });

    expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Luster shared texting number');
  });

  it('shows marketing email as unavailable with no toggle', async () => {
    mockEndpoints({});

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="email" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('marketing-email-row')).toHaveTextContent('Not available yet');
    });

    expect(screen.getByTestId('marketing-email-row').querySelector('input')).toBeNull();
    expect(screen.getByTestId('marketing-email-row').querySelector('button')).toBeNull();
  });

  it('disconnects Google Calendar after an explicit confirmation', async () => {
    const onDisconnect = vi.fn();
    mockEndpoints({
      health: { google: { status: 'active', readiness: 'ready', blockingCalendarCount: 1 } },
      onDisconnect,
    });

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="google" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('google-disconnect')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('google-disconnect'));

    expect(onDisconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('google-disconnect-confirm'));

    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText(/Google Calendar disconnected/i)).toBeInTheDocument();
    });
  });

  it('surfaces the OAuth callback notice passed from the URL', async () => {
    mockEndpoints({
      health: { google: { status: 'active', readiness: 'setup_incomplete' } },
    });

    render(
      <IntegrationsModal
        onClose={vi.fn()}
        salonSlug="salon-a"
        initialView="google"
        initialNotice="Google Calendar connected. Choose which calendars Luster should use."
      />,
    );

    expect(
      screen.getByText('Google Calendar connected. Choose which calendars Luster should use.'),
    ).toBeInTheDocument();

    // Let the health/calendars fetch effects settle before unmount.
    await waitFor(() => {
      expect(screen.getAllByText('Main calendar').length).toBeGreaterThan(0);
    });
  });

  /*
    Provider absence is a prerequisite Luster owes the owner, not a
    disconnection they can fix. Every one of these asserts that the UI says
    which, names the next step, and never claims something is working.
  */
  describe('provider absence is explained, never faked', () => {
    it('reports Google as "Not available yet" and names the prerequisite instead of offering Connect', async () => {
      mockEndpoints({ health: { availability: { google: false } } });

      render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" />);

      await waitFor(() => {
        expect(screen.getByTestId('integration-row-google')).toHaveTextContent(
          'Not available yet',
        );
      });

      expect(screen.getByTestId('integration-row-google')).not.toHaveTextContent(
        'Not connected',
      );
    });

    it('tells the owner who has to act on Google, and what still works meanwhile', async () => {
      mockEndpoints({ health: { availability: { google: false } } });

      render(
        <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="google" />,
      );

      const panel = await screen.findByTestId('google-unavailable');

      // The pill above the panel must agree with it: a status that still reads
      // "Not connected" invites a hunt for a Connect button that cannot exist.
      expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
      expect(screen.getAllByText('Not available yet').length).toBeGreaterThan(0);
      expect(panel).toHaveTextContent(/not switched on for your Luster account/i);
      expect(panel).toHaveTextContent(/Ask Luster support/i);
      expect(panel).toHaveTextContent(/booking page, confirmations and every appointment keep working/i);
      // No dead-end Connect button while there is nothing to connect to.
      expect(screen.queryByText('Connect Google Calendar')).not.toBeInTheDocument();
      expect(panel).not.toHaveTextContent(/temporarily unavailable/i);
    });

    it('says no confirmation emails are going out, and does not pair "Not available" with "No setup needed"', async () => {
      mockEndpoints({ health: { availability: { email: false } } });

      render(
        <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="email" />,
      );

      const notice = await screen.findByTestId('email-unavailable');

      expect(notice).toHaveTextContent(/no confirmation or reminder emails are going out/i);
      expect(notice).toHaveTextContent(/ask support to turn it on/i);
      expect(screen.queryByText(/No setup needed\./i)).not.toBeInTheDocument();
    });

    it('keeps automatic texting honest when Twilio is not offered here', async () => {
      stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
      mockEndpoints({ health: { availability: { twilio: false, twilioConnectOnboarding: false } } });

      render(
        <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent(
          'Not available yet',
        );
      });

      // Nothing chargeable is offered when the provider is absent.
      expect(screen.queryByTestId('twilio-preview')).not.toBeInTheDocument();
      expect(screen.getByTestId('manual-texting-section')).toHaveTextContent('Not available yet');
    });
  });

  it.each(['disconnected', 'pending', 'active'])(
    'never offers Twilio authorization or number purchase for stale %s onboarding data',
    async (status) => {
      mockEndpoints({ health: {
        twilio: { status, phoneNumber: status === 'active' ? '+14165550111' : null },
        availability: { twilio: true, twilioConnectOnboarding: true },
      } });
      render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />);
      await waitFor(() => expect(screen.getByTestId('manual-texting-section')).toHaveTextContent(status === 'disconnected' ? 'Not available yet' : 'Setup incomplete'));

      expect(screen.queryByText('Authorize Twilio')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Canadian area code')).not.toBeInTheDocument();
      expect(screen.queryByTestId('twilio-preview')).not.toBeInTheDocument();
      expect(screen.queryByTestId('twilio-provision')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: /buy this phone number/i })).not.toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/integrations/twilio/'))).toBe(false);
    },
  );

  it('shows retired texting connections as unavailable and does not invent a credit balance', async () => {
    mockEndpoints({ health: {
      twilio: { status: 'active', phoneNumber: '+14165550111' },
      sms: readySms({
        providerReady: false,
        senderMode: 'connected_byo',
        senderLabel: 'Retired texting connection',
        blockingReason: 'SENDER_NOT_READY',
        detail: 'Luster texts use SMS credits. This salon has a retired texting connection. Contact support before enabling Luster texting.',
        automaticEnabled: false,
        manualAvailable: false,
        remindersEnabled: false,
        availableCredits: null,
      }),
    } });
    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />);
    await waitFor(() => expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Retired texting connection'));

    expect(screen.getByTestId('manual-texting-section')).toHaveTextContent('Setup incomplete');
    expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Contact support before enabling Luster texting.');
    expect(screen.getByText('Luster SMS credit balance is unavailable. Contact support.')).toBeInTheDocument();
    expect(screen.queryByText(/billed by your Twilio account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 available/i)).not.toBeInTheDocument();
  });

  it('separates connection health from when things send, and offers the way across', async () => {
    const onOpenSettings = vi.fn();
    mockEndpoints({});

    render(
      <IntegrationsModal
        onClose={vi.fn()}
        salonSlug="salon-a"
        onOpenSettings={onOpenSettings}
      />,
    );

    const note = await screen.findByTestId('integrations-scope-note');

    expect(note).toHaveTextContent(/whether each channel is connected and working/i);
    expect(note).toHaveTextContent(/is set in Settings/i);

    fireEvent.click(screen.getByTestId('integrations-open-settings'));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows shared SMS identity, manual delivery and credits on desktop without offering BYO onboarding', async () => {
    stubUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    mockEndpoints({ health: {
      availability: { twilio: false, twilioConnectOnboarding: false },
      sms: readySms(),
    } });
    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />);
    await waitFor(() => expect(screen.getByTestId('manual-texting-section')).toHaveTextContent('Ready'));

    expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Luster shared texting number');
    expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('42 available');
    expect(screen.queryByText('Authorize Twilio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('twilio-preview')).not.toBeInTheDocument();
  });

  it('does not offer a number purchase while BYO onboarding is disabled', async () => {
    mockEndpoints({ health: { twilio: { status: 'pending' }, availability: { twilioConnectOnboarding: false } } });
    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />);
    await waitFor(() => expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Setup incomplete'));

    expect(screen.queryByText('Authorize Twilio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('twilio-preview')).not.toBeInTheDocument();
  });

  it.each([
    ['GLOBAL_SMS_DISABLED', 'Paused', 'Luster has temporarily paused SMS sending. Your credits and preferences are saved.'],
    ['PILOT_NOT_ENABLED', 'Not available yet', 'Luster SMS is not available for this salon yet. Your credits and preferences are saved.'],
  ])('keeps 100 credits separate from the %s sending restriction', async (blockingReason, label, detail) => {
    const onOpenSettings = vi.fn();
    mockEndpoints({
      smsReminders: 'UPGRADE_REQUIRED',
      health: {
        sms: readySms({
          providerReady: false,
          automaticEnabled: false,
          manualAvailable: false,
          remindersEnabled: false,
          availableCredits: 100,
          blockingReason,
          detail,
        }),
      },
    });
    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" onOpenSettings={onOpenSettings} />);
    await waitFor(() => expect(screen.getByTestId('manual-texting-section')).toHaveTextContent(label));

    expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent(label);
    expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('100 available');
    expect(screen.getByTestId('manual-texting-section')).toHaveTextContent(detail);
    expect(screen.queryByText(/upgrade required/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Authorize Twilio')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Manage texts and reminders in Settings' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false);
  });
});
