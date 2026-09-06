import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsModal } from './IntegrationsModal';

type HealthOverrides = {
  google?: Record<string, unknown>;
  twilio?: Record<string, unknown>;
  availability?: Record<string, unknown>;
  latestSmsDeliveryError?: Record<string, unknown> | null;
};

function healthPayload(overrides: HealthOverrides = {}) {
  return {
    data: {
      availability: {
        google: true,
        twilio: true,
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
      latestSmsDeliveryError: overrides.latestSmsDeliveryError ?? null,
    },
  };
}

const fetchMock = vi.fn();

function mockEndpoints(options: {
  health?: HealthOverrides;
  smsReminders?: 'ENABLED' | 'MODULE_DISABLED' | 'UPGRADE_REQUIRED';
  onDisconnect?: () => void;
  onProvision?: () => void;
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
    if (url.startsWith('/api/integrations/twilio/provision')) {
      if (init?.method === 'POST') {
        options.onProvision?.();
        return new Response(
          JSON.stringify({ data: { phoneNumber: '+14165550188' } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            number: { phone_number: '+14165550188' },
            monthlyPrice: '1.15',
            currency: 'CAD',
          },
        }),
        { status: 200 },
      );
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

  it('shows honest home statuses: texting is "Manual ready" without Twilio, never disconnected', async () => {
    mockEndpoints({ health: { twilio: { status: 'disconnected' } } });

    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" />);

    await waitFor(() => {
      expect(screen.getByTestId('integration-row-google')).toHaveTextContent('Not connected');
    });

    expect(screen.getByTestId('integration-row-texting')).toHaveTextContent('Manual ready');
    expect(screen.getByTestId('integration-row-texting')).not.toHaveTextContent(/disconnected/i);
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

  it('manual texting works without Twilio on a phone; automatic stays Not connected', async () => {
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    mockEndpoints({ health: { twilio: { status: 'disconnected' } } });

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Not connected');
    });

    expect(screen.getByTestId('manual-texting-section')).toHaveTextContent('Ready');
    expect(screen.getByTestId('manual-texting-section')).toHaveTextContent(/no Twilio needed/i);
    expect(screen.getByText('Authorize Twilio')).toBeInTheDocument();
  });

  it('flags manual texting as unsupported on a desktop browser', async () => {
    stubUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    mockEndpoints({});

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('manual-texting-section')).toHaveTextContent(
        'Unsupported on this device',
      );
    });
  });

  it('does not report automatic texting Ready while setup is incomplete', async () => {
    mockEndpoints({
      health: { twilio: { status: 'active', phoneNumber: '+14165550111' } },
      smsReminders: 'MODULE_DISABLED',
    });

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Setup incomplete');
    });

    expect(screen.getByTestId('automatic-texting-section')).not.toHaveTextContent(/^Ready$/);
  });

  it('reports automatic texting Ready only when the number and module are both live', async () => {
    mockEndpoints({
      health: { twilio: { status: 'active', phoneNumber: '+14165550111' } },
      smsReminders: 'ENABLED',
    });

    render(
      <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Ready');
    });

    expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('+14165550111');
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
      mockEndpoints({ health: { availability: { twilio: false } } });

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
      expect(screen.getByTestId('manual-texting-section')).toHaveTextContent('Ready');
    });
  });

  describe('buying a Twilio number', () => {
    it('never provisions on a single tap and names the recurring charge in the confirmation', async () => {
      const onProvision = vi.fn();
      mockEndpoints({ health: { twilio: { status: 'pending' } }, onProvision });

      render(
        <IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" initialView="texting" />,
      );

      fireEvent.click(await screen.findByTestId('twilio-preview'));

      const buy = await screen.findByTestId('twilio-provision');

      expect(onProvision).not.toHaveBeenCalled();

      fireEvent.click(buy);

      const dialog = await screen.findByTestId('confirm-dialog');

      expect(dialog).toHaveTextContent('+14165550188');
      expect(dialog).toHaveTextContent(/1\.15 CAD per month/i);
      expect(dialog).toHaveTextContent(/your own Twilio account/i);
      // Opening the confirmation must not have bought anything.
      expect(onProvision).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      });

      expect(onProvision).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('twilio-provision'));
      fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(onProvision).toHaveBeenCalledTimes(1);
      });
    });
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
});
