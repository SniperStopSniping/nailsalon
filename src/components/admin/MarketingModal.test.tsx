import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RetentionSettings } from '@/types/retention';

import { MarketingModal } from './MarketingModal';

const { backMock, fetchMock, pushMock, replaceMock, state, settingsModalMock } = vi.hoisted(() => ({
  backMock: vi.fn(),
  fetchMock: vi.fn(),
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  state: { query: '' },
  settingsModalMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ back: backMock, push: pushMock, replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(state.query),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'salon-a' }),
}));

vi.mock('./SettingsModal', () => ({
  SettingsModal: (props: { initialView?: string; onClose?: () => void }) => {
    settingsModalMock(props);
    return (
      <button
        type="button"
        data-testid={`${props.initialView ?? 'settings'}-settings-modal`}
        onClick={props.onClose}
      />
    );
  },
}));

const availableServices = [
  { id: 'service-gel', name: 'Gel manicure' },
  { id: 'service-pedi', name: 'Gel pedicure' },
];

function makeSettings(overrides: Partial<RetentionSettings> = {}): RetentionSettings {
  return {
    defaultRebookDays: 21,
    reminderLeadHours: 24,
    googleReviewUrl: 'https://g.page/r/salon-a/review',
    parkingInstructions: 'Park behind the salon.',
    sixWeekPromotion: {
      enabled: true,
      name: 'We miss you',
      discountType: 'fixed',
      value: 1000,
      eligibleServiceIds: ['service-gel'],
      expiryDays: 14,
      code: 'MISS10',
      messageTemplate: 'Hi {firstName}, enjoy {offer}: {bookingLink}',
      singleUse: true,
    },
    eightWeekPromotion: {
      enabled: true,
      name: 'Come back soon',
      discountType: 'fixed',
      value: 2000,
      eligibleServiceIds: [],
      expiryDays: 21,
      code: 'BACK20',
      messageTemplate: 'Hi {firstName}, enjoy {offer}: {bookingLink}',
      singleUse: true,
    },
    ...overrides,
  };
}

const OVERVIEW = {
  currency: 'CAD',
  followups: {
    groups: [
      {
        id: 'rebook',
        title: 'Due to return',
        items: [{
          clientId: 'sclient_1',
          clientName: 'Ava Client',
          phone: '4165550111',
          stage: 'rebook',
          dueAt: '2026-07-15T12:00:00.000Z',
          lastVisitAt: '2026-06-20T12:00:00.000Z',
          lastServiceName: 'BIAB Short',
          hasUpcomingAppointment: false,
          smsConsent: true,
        }],
      },
      { id: 'promo_6w', title: 'Win-back — stage 1', items: [] },
      {
        id: 'promo_8w',
        title: 'Win-back — stage 2',
        items: [{
          clientId: 'sclient_2',
          clientName: 'Bea Client',
          phone: '4165550112',
          stage: 'promo_8w',
          dueAt: '2026-07-10T12:00:00.000Z',
          lastVisitAt: '2026-05-01T12:00:00.000Z',
          lastServiceName: null,
          hasUpcomingAppointment: false,
          smsConsent: false,
        }],
      },
    ],
    reminders: [],
  },
  results: {
    windowDays: 30,
    outreach: [
      { kind: 'rebook', status: 'prepared', count: 4 },
      { kind: 'rebook', status: 'marked_sent', count: 3 },
      { kind: 'promo_6w', status: 'converted', count: 1 },
    ],
    campaigns: [{
      stage: 'promo_6w',
      minted: 5,
      redeemed: 2,
      discountGivenCents: 2000,
      completedCount: 1,
      completedRevenueCents: 10000,
      completedTaxCents: 1300,
      unresolvedFinancialCount: 0,
    }],
    automatic: [{ channel: 'sms', status: 'delivered', count: 7 }],
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function settingsResponse(settings: RetentionSettings) {
  return jsonResponse({ data: { settings, availableServices } });
}

function installSuccessfulFetch(initialSettings = makeSettings(), options: {
  lusterReady?: boolean;
  legacyConnection?: boolean;
  sms?: Record<string, unknown>;
} = {}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/admin/retention/settings') && init?.method === 'PATCH') {
      return settingsResponse(JSON.parse(String(init.body)) as RetentionSettings);
    }
    if (url.startsWith('/api/admin/retention/settings')) {
      return settingsResponse(initialSettings);
    }
    if (url.startsWith('/api/admin/review-requests/settings')) {
      return jsonResponse({
        data: {
          googleReviewUrl: initialSettings.googleReviewUrl,
          automaticEnabled: false,
          delayMinutes: 60,
          messageTemplate: 'Hi {{firstName}}, review {{businessName}}: {{reviewLink}}',
          businessName: 'Luster Demo Studio',
        },
      });
    }
    if (url.startsWith('/api/admin/marketing')) {
      return jsonResponse({ data: OVERVIEW });
    }
    if (url.startsWith('/api/admin/today')) {
      return jsonResponse({ data: { links: { bookingUrl: 'https://luster.test/book' }, timeZone: 'America/Toronto' } });
    }
    if (url.startsWith('/api/integrations/health')) {
      return jsonResponse({
        data: {
          availability: { google: false, twilio: false, email: false, photos: false },
          google: { status: 'disconnected' },
          ...(options.lusterReady || options.sms
            ? {
                sms: {
                  senderMode: 'shared_luster',
                  senderLabel: 'Luster texting number',
                  providerReady: true,
                  automaticEnabled: true,
                  manualAvailable: true,
                  smsEnabled: true,
                  remindersEnabled: true,
                  availableCredits: 100,
                  phoneNumber: null,
                  blockingReason: null,
                  detail: 'Luster SMS is ready and uses your SMS credits.',
                  workerConfigured: true,
                  quietHours: { enabled: false, start: '21:00', end: '09:00' },
                  ...options.sms,
                },
              }
            : {}),
          twilio: options.legacyConnection
            ? { status: 'active', phoneNumber: '+16475550000' }
            : { status: 'disconnected', phoneNumber: null },
        },
      });
    }
    if (url.startsWith('/api/admin/settings/modules')) {
      return jsonResponse({
        data: { moduleReasons: { smsReminders: options.lusterReady ? 'ENABLED' : 'MODULE_DISABLED' } },
      });
    }
    if (url.startsWith('/api/admin/salon/settings')) {
      return jsonResponse({
        sms: options.sms ?? null,
        communications: {
          email: { enabled: true },
          sms: { enabled: options.lusterReady === true },
          killSwitch: false,
          quietHours: { enabled: true, start: '21:00', end: '09:00' },
          reminders: { rules: [] },
          events: {},
        },
      });
    }
    if (url.startsWith('/api/admin/clients/') && url.includes('/messages')) {
      return jsonResponse({
        data: {
          history: [],
          sms: {
            senderMode: 'shared_luster',
            senderLabel: 'Luster texting number',
            providerReady: true,
            automaticEnabled: true,
            manualAvailable: true,
            smsEnabled: true,
            remindersEnabled: true,
            availableCredits: 100,
            phoneNumber: null,
            blockingReason: null,
            detail: 'Luster SMS is ready.',
            workerConfigured: true,
            quietHours: { enabled: false, start: '21:00', end: '09:00' },
          },
        },
      });
    }
    if (url.startsWith('/api/admin/retention/campaigns') && init?.method === 'POST') {
      return jsonResponse({
        data: {
          campaign: {
            id: 'campaign_1',
            stage: 'promo_8w',
            expiresAt: '2026-08-01T00:00:00.000Z',
            bookingUrl: 'https://luster.test/book?campaign=tok',
          },
        },
      }, 201);
    }
    if (url.startsWith('/api/admin/retention') && init?.method === 'POST') {
      return jsonResponse({ data: { communication: { id: 'comm_1' } } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

async function renderMarketing(props: Partial<Parameters<typeof MarketingModal>[0]> = {}) {
  render(
    <MarketingModal
      onClose={vi.fn()}
      salonName="Luster Demo Studio"
      {...props}
    />,
  );
  await screen.findByTestId('marketing-home');
}

function queryOf(href: string) {
  return new URL(href, 'https://luster.test').searchParams;
}

describe('MarketingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.query = '';
    vi.stubGlobal('fetch', fetchMock);
    // jsdom userAgent is not a phone — tests opt into mobile via stub.
  });

  it('home answers who needs follow-up, channel truth, and setup — with real counts only', async () => {
    installSuccessfulFetch();
    await renderMarketing();

    expect(screen.getByText('Write a message')).toBeInTheDocument();
    expect(screen.getByText('Choose a client, write or use a saved message, then send your way.')).toBeInTheDocument();
    expect(screen.getByTestId('marketing-home-followups')).toHaveTextContent('2 due');
    expect(screen.getByTestId('marketing-home-results')).toHaveTextContent('3 sent · 2 redeemed');
    expect(screen.getByTestId('marketing-home-appointment-messages')).toHaveTextContent('Not available yet');
    expect(screen.queryByTestId('marketing-home-texting-settings')).not.toBeInTheDocument();
    // No email marketing toggle exists anywhere.
    expect(screen.queryByRole('checkbox', { name: /email/i })).not.toBeInTheDocument();
  });

  it('automatic texting shows Ready from canonical Luster SMS readiness', async () => {
    installSuccessfulFetch(makeSettings(), { lusterReady: true });
    await renderMarketing();

    expect(screen.getByTestId('marketing-home-appointment-messages')).toHaveTextContent('Luster texting ready');
  });

  it('explains a Luster sending pause and opens its settings in this workspace', async () => {
    installSuccessfulFetch(makeSettings(), {
      sms: {
        providerReady: false,
        automaticEnabled: false,
        manualAvailable: false,
        remindersEnabled: false,
        blockingReason: 'GLOBAL_SMS_DISABLED',
        detail: 'Luster has temporarily paused SMS sending. Your credits and preferences are saved.',
      },
    });
    await renderMarketing();

    expect(screen.getByTestId('marketing-home-appointment-messages')).toHaveTextContent('Paused');
    expect(screen.getByText(/Luster has temporarily paused SMS sending/)).toBeInTheDocument();
    expect(screen.queryByText(/finish texting setup/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('marketing-home-appointment-messages'));

    expect(await screen.findByTestId('communications-settings-modal')).toBeInTheDocument();
    expect(settingsModalMock).toHaveBeenCalledWith(expect.objectContaining({
      initialView: 'communications',
      leafOnly: true,
      leafBackLabel: 'Marketing & Messages',
      salonSlug: 'salon-a',
    }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false);
  });

  it('keeps the complete existing appointment message controls inside Marketing & Messages', async () => {
    installSuccessfulFetch();
    await renderMarketing();

    fireEvent.click(screen.getByTestId('marketing-home-appointment-messages'));

    expect(await screen.findByTestId('communications-settings-modal')).toBeInTheDocument();
    expect(settingsModalMock).toHaveBeenCalledWith(expect.objectContaining({
      initialView: 'communications',
      leafOnly: true,
      leafBackLabel: 'Marketing & Messages',
    }));
  });

  it('keeps Smart Fit under Offers and reuses its existing Settings editor', async () => {
    installSuccessfulFetch();
    await renderMarketing();

    fireEvent.click(screen.getByTestId('marketing-home-offers'));

    expect(await screen.findByTestId('marketing-offers')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('marketing-offers-smart-fit'));

    expect(await screen.findByTestId('smart-fit-settings-modal')).toBeInTheDocument();
    expect(settingsModalMock).toHaveBeenCalledWith(expect.objectContaining({
      initialView: 'smart-fit',
      leafOnly: true,
      salonSlug: 'salon-a',
      smartFitResultsAvailable: false,
    }));
  });

  it('passes the Analytics gate to the reused Smart Fit editor', async () => {
    const onOpenApp = vi.fn();
    installSuccessfulFetch();
    await renderMarketing({ onOpenApp, smartFitResultsAvailable: true });

    fireEvent.click(screen.getByTestId('marketing-home-offers'));
    fireEvent.click(await screen.findByTestId('marketing-offers-smart-fit'));

    expect(settingsModalMock).toHaveBeenCalledWith(expect.objectContaining({
      onOpenApp,
      smartFitResultsAvailable: true,
    }));
  });

  it('uses browser Back for a view it pushed, without adding a duplicate home entry', async () => {
    installSuccessfulFetch();
    await renderMarketing();

    fireEvent.click(screen.getByTestId('marketing-home-appointment-messages'));
    await screen.findByTestId('communications-settings-modal');
    fireEvent.click(screen.getByTestId('communications-settings-modal'));

    expect(backMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('marketing-home')).toBeInTheDocument();
  });

  it('replaces a direct Reviews link with Marketing home instead of growing history', async () => {
    state.query = 'salon=salon-a&returnTo=calendar&app=marketing&view=reviews';
    installSuccessfulFetch();
    render(<MarketingModal onClose={vi.fn()} salonName="Luster Demo Studio" />);

    await screen.findByTestId('marketing-reviews');
    fireEvent.click(screen.getByRole('button', { name: 'Marketing & Messages' }));

    expect(backMock).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining('salon=salon-a&returnTo=calendar&app=marketing'),
      { scroll: false },
    );
    expect(replaceMock.mock.calls[0]![0]).not.toContain('view=reviews');
  });

  it('keeps the legacy follow-ups URL by replacing it with Clients insights', async () => {
    state.query = 'salon=salon-a&returnTo=calendar&app=marketing&view=followups';
    installSuccessfulFetch();
    render(<MarketingModal onClose={vi.fn()} salonName="Luster Demo Studio" />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining('app=clients&view=insights'),
      { scroll: false },
    ));
    const query = queryOf(replaceMock.mock.calls[0]![0]);

    expect(query.get('salon')).toBe('salon-a');
    expect(query.get('returnTo')).toBe('calendar');
  });

  it('routes the first-visit offer shortcut to the existing Services menu', async () => {
    const onOpenApp = vi.fn();
    installSuccessfulFetch();
    await renderMarketing({ onOpenApp });

    fireEvent.click(screen.getByTestId('marketing-home-offers'));
    fireEvent.click(await screen.findByTestId('marketing-offers-first-visit'));

    expect(onOpenApp).toHaveBeenCalledWith('services');
  });

  it('pushes canonical Marketing views while retaining salon and return context', async () => {
    state.query = 'salon=salon-a&returnTo=calendar&app=marketing';
    installSuccessfulFetch();
    await renderMarketing();

    fireEvent.click(screen.getByTestId('marketing-home-appointment-messages'));

    expect(pushMock).toHaveBeenCalledTimes(1);

    const query = queryOf(pushMock.mock.calls[0]![0]);

    expect(query.get('salon')).toBe('salon-a');
    expect(query.get('returnTo')).toBe('calendar');
    expect(query.get('app')).toBe('marketing');
    expect(query.get('view')).toBe('messages');
  });

  it('keeps the existing reviews deep link on Review Requests', async () => {
    state.query = 'salon=salon-a&returnTo=calendar&app=marketing&view=reviews';
    installSuccessfulFetch();
    render(<MarketingModal onClose={vi.fn()} salonName="Luster Demo Studio" />);

    expect(await screen.findByTestId('marketing-reviews')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review Requests' })).toBeVisible();
  });

  it('never reports a legacy salon-owned Twilio number as ready', async () => {
    installSuccessfulFetch(makeSettings(), { legacyConnection: true });
    await renderMarketing();

    expect(screen.getByTestId('marketing-home-appointment-messages')).toHaveTextContent('Setup incomplete');
    expect(screen.getByTestId('marketing-home-appointment-messages')).not.toHaveTextContent('Luster texting ready');
  });

  it('routes follow-ups to the canonical Clients insights workflow', async () => {
    installSuccessfulFetch();
    state.query = 'salon=salon-a&returnTo=calendar&app=marketing';
    await renderMarketing();
    fireEvent.click(screen.getByTestId('marketing-home-followups'));

    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining('app=clients&view=insights'),
      { scroll: false },
    );
  });

  it('results show only measured outcomes with tax separated from revenue and no click metrics', async () => {
    installSuccessfulFetch();
    await renderMarketing();
    fireEvent.click(screen.getByTestId('marketing-home-results'));

    const results = await screen.findByTestId('marketing-results');

    expect(results).toHaveTextContent('Opened for sending');
    expect(results).toHaveTextContent('Marked sent');
    expect(results).toHaveTextContent('Promotion redeemed');
    // Finalized revenue, tax reported separately and labeled as not-revenue.
    expect(screen.getByTestId('campaign-revenue-promo_6w')).toHaveTextContent('$100.00');
    expect(results).toHaveTextContent('Tax collected (not revenue)');
    expect(results).toHaveTextContent('$13.00');
    // Preserve the existing aggregate of automatic confirmation, reminder and
    // cancellation outcomes while keeping reminder configuration elsewhere.
    expect(screen.getByTestId('marketing-results-automatic')).toHaveTextContent(
      'Automatic appointment messages · last 30 days',
    );
    expect(screen.getByTestId('marketing-results-automatic')).toHaveTextContent('sms · delivered');
    expect(screen.getByTestId('marketing-results-automatic')).toHaveTextContent('7');
    // Unmeasurable outcomes never appear.
    expect(results).not.toHaveTextContent(/click/i);
    expect(results).toHaveTextContent(/cannot see Messages deliveries/i);
  });

  it('campaigns present the staged win-back sequence while saving the exact same settings shape', async () => {
    installSuccessfulFetch();
    await renderMarketing();
    fireEvent.click(screen.getByTestId('marketing-home-campaigns'));
    await screen.findByText('Win-back sequence');

    expect(screen.getByText(/Stage 1 — after 42 days without a visit/)).toBeInTheDocument();
    expect(screen.getByText(/Stage 2 — after 56 days if the client still has not booked/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Rebook clients after/)).toHaveValue(21);

    fireEvent.change(screen.getByLabelText('Six-week win-back discount'), { target: { value: '12.34' } });
    fireEvent.click(screen.getByLabelText('Six-week win-back: Gel pedicure'));
    fireEvent.click(screen.getByRole('button', { name: 'Save marketing settings' }));

    await screen.findByText('Marketing settings saved.');

    const patchCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    const body = JSON.parse(String((patchCall![1] as RequestInit).body)) as RetentionSettings;

    // Same persisted shape as before this phase: enabled/timing/discount/
    // expiry/code/services/template/single-use all preserved.
    expect(body.sixWeekPromotion.value).toBe(1234);
    expect(body.sixWeekPromotion.eligibleServiceIds).toEqual(['service-gel', 'service-pedi']);
    expect(body.sixWeekPromotion.singleUse).toBe(true);
    expect(body.sixWeekPromotion.code).toBe('MISS10');
    expect(body.eightWeekPromotion.expiryDays).toBe(21);
    expect(body.defaultRebookDays).toBe(21);
  });

  it('focuses the promotion stage requested by a client win-back alert', async () => {
    installSuccessfulFetch();
    render(
      <MarketingModal
        onClose={vi.fn()}
        initialPromotionStage="promo_8w"
      />,
    );

    const eightWeekSettings = await screen.findByRole('region', {
      name: 'Eight-week win-back promotion settings',
    });

    expect(eightWeekSettings).toHaveAttribute('data-highlighted', 'true');

    await waitFor(() => expect(eightWeekSettings).toHaveFocus());

    expect(screen.getByRole('region', {
      name: 'Six-week win-back promotion settings',
    })).not.toHaveAttribute('data-highlighted');
  });

  it('blocks an eight-week offer that is smaller than the six-week offer', async () => {
    const settings = makeSettings({
      sixWeekPromotion: { ...makeSettings().sixWeekPromotion, discountType: 'percent', value: 25 },
      eightWeekPromotion: { ...makeSettings().eightWeekPromotion, discountType: 'percent', value: 30 },
    });
    installSuccessfulFetch(settings);
    await renderMarketing();
    fireEvent.click(screen.getByTestId('marketing-home-campaigns'));
    await screen.findByText('Win-back sequence');

    fireEvent.change(screen.getByLabelText('Eight-week win-back discount'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save marketing settings' }));

    expect(await screen.findByText('The eight-week offer must be at least as large as the six-week offer.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toHaveLength(0);
  });

  it('reviews use the shared automatic-review settings editor', async () => {
    installSuccessfulFetch();
    await renderMarketing();
    fireEvent.click(screen.getByTestId('marketing-home-reviews'));

    expect(await screen.findByTestId('marketing-reviews')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/review-requests/settings'),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('shows a load error and retries the settings request', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/retention/settings')) {
        return jsonResponse({ error: { code: 'TEMPORARY', message: 'Temporary settings error' } }, 503);
      }
      return jsonResponse({ data: OVERVIEW });
    });

    render(<MarketingModal onClose={vi.fn()} />);

    expect(await screen.findByText('Temporary settings error')).toBeInTheDocument();

    installSuccessfulFetch();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('marketing-home')).toBeInTheDocument();
  });
});
