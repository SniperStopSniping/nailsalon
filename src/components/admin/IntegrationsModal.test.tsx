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

  it('shows honest home statuses: texting is "Manual ready" without Twilio, never disconnected', async () => {
    mockEndpoints({ health: { twilio: { status: 'disconnected' } } });

    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" />);

    await waitFor(() => {
      expect(screen.getByTestId('integration-row-texting')).toHaveTextContent('Manual ready');
    });

    expect(screen.getByTestId('integration-row-texting')).not.toHaveTextContent(/disconnected/i);
    expect(screen.getByTestId('integration-row-google')).toHaveTextContent('Not connected');
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
      expect(screen.getByTestId('manual-texting-section')).toHaveTextContent('Ready');
    });

    expect(screen.getByTestId('manual-texting-section')).toHaveTextContent(/no Twilio needed/i);
    expect(screen.getByTestId('automatic-texting-section')).toHaveTextContent('Not connected');
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
});
