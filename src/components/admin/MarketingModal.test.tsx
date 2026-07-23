import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RetentionSettings } from '@/types/retention';

import { MarketingModal } from './MarketingModal';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'salon-a' }),
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
  twilioReady?: boolean;
} = {}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/admin/retention/settings') && init?.method === 'PATCH') {
      return settingsResponse(JSON.parse(String(init.body)) as RetentionSettings);
    }
    if (url.startsWith('/api/admin/retention/settings')) {
      return settingsResponse(initialSettings);
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
          availability: { google: false, twilio: options.twilioReady ?? false, email: false, photos: false },
          google: { status: 'disconnected' },
          twilio: options.twilioReady
            ? { status: 'active', phoneNumber: '+16475550000' }
            : { status: 'disconnected', phoneNumber: null },
        },
      });
    }
    if (url.startsWith('/api/admin/settings/modules')) {
      return jsonResponse({
        data: { moduleReasons: { smsReminders: options.twilioReady ? 'ENABLED' : 'MODULE_DISABLED' } },
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

describe('MarketingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    // jsdom userAgent is not a phone — tests opt into mobile via stub.
  });

  it('home answers who needs follow-up, channel truth, and setup — with real counts only', async () => {
    installSuccessfulFetch();
    await renderMarketing();

    expect(screen.getByText('Grow your bookings')).toBeInTheDocument();
    expect(screen.getByText('Follow up with clients, fill open time and promote your services.')).toBeInTheDocument();
    expect(screen.getByTestId('marketing-home-followups')).toHaveTextContent('2 due');
    expect(screen.getByTestId('marketing-home-results')).toHaveTextContent('3 sent · 2 redeemed');
    // Channel truth: automatic not ready, marketing email honestly absent.
    expect(screen.getByTestId('marketing-automatic-status')).toHaveTextContent('Not available yet');
    expect(screen.getByTestId('marketing-home-channels')).toHaveTextContent('Marketing email');
    expect(screen.getByTestId('marketing-home-channels')).toHaveTextContent('Not available yet');
    // No email marketing toggle exists anywhere.
    expect(screen.queryByRole('checkbox', { name: /email/i })).not.toBeInTheDocument();
  });

  it('automatic texting shows Ready only when the provider and module are both ready', async () => {
    installSuccessfulFetch(makeSettings(), { twilioReady: true });
    await renderMarketing();

    expect(screen.getByTestId('marketing-automatic-status')).toHaveTextContent('Ready');
  });

  it('follow-up rows show reason, last service, consent and honest channel', async () => {
    installSuccessfulFetch();
    await renderMarketing();
    fireEvent.click(screen.getByTestId('marketing-home-followups'));

    const row = await screen.findByTestId('followup-row-sclient_1');

    expect(row).toHaveTextContent('Ava Client');
    expect(row).toHaveTextContent('Due to return');
    expect(row).toHaveTextContent('last: BIAB Short');
    expect(row).toHaveTextContent('no upcoming visit');
    expect(row).toHaveTextContent('Text (manual)');
    expect(row).toHaveTextContent('Text consent on file');

    const row2 = screen.getByTestId('followup-row-sclient_2');

    expect(row2).toHaveTextContent('No text consent recorded');
    // Staged sequence copy uses plain-language timing.
    expect(screen.getByText('After 56 days if the client still has not booked')).toBeInTheDocument();
  });

  it('review-and-text opens an editable preview whose composer launch is recorded as prepared, never sent', async () => {
    installSuccessfulFetch();
    const openNative = vi.fn();
    await renderMarketing({ onOpenNativeUrl: openNative });
    fireEvent.click(screen.getByTestId('marketing-home-followups'));
    fireEvent.click(await screen.findByTestId('followup-review-text-sclient_1'));

    const preview = await screen.findByTestId('marketing-message-preview');

    expect(preview).toHaveTextContent('4165550111');
    expect(preview).toHaveClass('touch-pan-y', 'overflow-y-auto', 'overscroll-contain');
    expect(screen.getByText(/Messages app will open with this message ready to review/i)).toBeInTheDocument();

    // Editable message with prefilled, fully-resolved copy (no {placeholders}).
    const textarea = screen.getByTestId('marketing-preview-message') as HTMLTextAreaElement;

    expect(textarea.value).toContain('Ava');
    expect(textarea.value).toContain('Luster Demo Studio');
    expect(textarea.value).not.toMatch(/\{\w+\}/);

    fireEvent.change(textarea, { target: { value: `${textarea.value} See you soon!` } });
    fireEvent.click(screen.getByTestId('marketing-preview-open'));

    // Prefilled recipient + edited body reach the native composer URL.
    await waitFor(() => expect(openNative).toHaveBeenCalledTimes(1));

    const href = openNative.mock.calls[0]![0] as string;

    expect(href.startsWith('sms:4165550111')).toBe(true);
    expect(decodeURIComponent(href)).toContain('See you soon!');

    // Opening recorded ONLY as prepared — and the outcome question appears.
    const prepared = fetchMock.mock.calls.filter(([url, init]) =>
      String(url).startsWith('/api/admin/retention?')
      && (init as RequestInit | undefined)?.method === 'POST');

    expect(prepared).toHaveLength(1);
    expect(JSON.parse(String((prepared[0]![1] as RequestInit).body)).status).toBe('prepared');
    expect(await screen.findByTestId('marketing-did-you-send')).toHaveClass(
      'touch-pan-y',
      'overflow-y-auto',
      'overscroll-contain',
    );

    // Only the explicit confirmation records marked_sent.
    fireEvent.click(screen.getByTestId('marketing-mark-sent'));
    await waitFor(() => {
      const statuses = fetchMock.mock.calls
        .filter(([url, init]) => String(url).startsWith('/api/admin/retention?') && (init as RequestInit | undefined)?.method === 'POST')
        .map(([, init]) => JSON.parse(String((init as RequestInit).body)).status);

      expect(statuses).toEqual(['prepared', 'marked_sent']);
    });
  });

  it('offers a desktop fallback with copy actions instead of pretending sms links work', async () => {
    installSuccessfulFetch();
    await renderMarketing();
    fireEvent.click(screen.getByTestId('marketing-home-followups'));
    fireEvent.click(await screen.findByTestId('followup-review-text-sclient_1'));
    await screen.findByTestId('marketing-message-preview');

    // jsdom's user agent is not a phone → the fallback renders.
    expect(screen.getByTestId('marketing-desktop-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('marketing-copy-phone')).toBeInTheDocument();
    expect(screen.getByTestId('marketing-copy-message')).toBeInTheDocument();
  });

  it('win-back texting for an unconfigured offer routes to Campaigns instead of failing silently', async () => {
    installSuccessfulFetch(makeSettings({
      eightWeekPromotion: { ...makeSettings().eightWeekPromotion, enabled: false },
    }));
    await renderMarketing();
    fireEvent.click(screen.getByTestId('marketing-home-followups'));
    fireEvent.click(await screen.findByTestId('followup-review-text-sclient_2'));

    expect(await screen.findByTestId('marketing-campaigns')).toBeInTheDocument();
    expect(screen.getByText('Set up this win-back offer before texting it.')).toBeInTheDocument();
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
    // Automatic block is honestly scoped to appointment messages.
    expect(screen.getByTestId('marketing-results-automatic')).toHaveTextContent('not marketing');
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

  it('reviews keep the manual workflow honest and never duplicate directions', async () => {
    installSuccessfulFetch();
    await renderMarketing();
    fireEvent.click(screen.getByTestId('marketing-home-reviews'));

    const reviews = await screen.findByTestId('marketing-reviews');

    expect(screen.getByLabelText(/Direct Google review link/)).toHaveValue('https://g.page/r/salon-a/review');
    expect(reviews).toHaveTextContent(/never counted as a sent request/i);
    expect(reviews).toHaveTextContent(/never claims a Google review was posted/i);
    // Directions/parking live in Settings → Locations only.
    expect(reviews).toHaveTextContent(/Settings → Locations/);
    expect(screen.queryByLabelText(/Parking/)).not.toBeInTheDocument();
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
