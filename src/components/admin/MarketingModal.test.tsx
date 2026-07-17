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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function settingsResponse(settings: RetentionSettings) {
  return jsonResponse({
    data: {
      settings,
      availableServices,
    },
  });
}

function installSuccessfulFetch(initialSettings = makeSettings()) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PATCH') {
      return settingsResponse(JSON.parse(String(init.body)) as RetentionSettings);
    }
    if (url === '/api/admin/retention/settings?salonSlug=salon-a') {
      return settingsResponse(initialSettings);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe('MarketingModal retention settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads real timing, review, directions, service, and promotion settings', async () => {
    installSuccessfulFetch();

    render(<MarketingModal onClose={vi.fn()} />);

    expect(screen.getByText('Loading retention settings…')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Park behind the salon.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Rebook clients after/)).toHaveValue(21);
    expect(screen.getByLabelText(/Appointment reminder/)).toHaveValue(24);
    expect(screen.getByLabelText(/Direct Google review link/)).toHaveValue('https://g.page/r/salon-a/review');
    expect(screen.getByRole('checkbox', { name: 'Enable Six-week win-back' })).toBeChecked();
    expect(screen.getAllByText('Gel manicure')).toHaveLength(2);
    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/retention/settings?salonSlug=salon-a');
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

  it('saves fixed discounts as cents and selected service IDs', async () => {
    installSuccessfulFetch();
    render(<MarketingModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Park behind the salon.');

    fireEvent.change(screen.getByLabelText(/Rebook clients after/), { target: { value: '28' } });
    fireEvent.change(screen.getByLabelText('Six-week win-back discount'), { target: { value: '12.34' } });
    fireEvent.click(screen.getByLabelText('Six-week win-back: Gel pedicure'));
    fireEvent.click(screen.getByRole('button', { name: 'Save retention settings' }));

    await screen.findByText('Retention settings saved.');
    const patchCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');

    expect(patchCall).toBeDefined();

    const [url, init] = patchCall!;

    expect(url).toBe('/api/admin/retention/settings?salonSlug=salon-a');

    const body = JSON.parse(String((init as RequestInit).body)) as RetentionSettings;

    expect(body.defaultRebookDays).toBe(28);
    expect(body.sixWeekPromotion.value).toBe(1234);
    expect(body.sixWeekPromotion.eligibleServiceIds).toEqual(['service-gel', 'service-pedi']);
  });

  it('blocks an eight-week offer that is smaller than the six-week offer', async () => {
    const settings = makeSettings({
      sixWeekPromotion: {
        ...makeSettings().sixWeekPromotion,
        discountType: 'percent',
        value: 25,
      },
      eightWeekPromotion: {
        ...makeSettings().eightWeekPromotion,
        discountType: 'percent',
        value: 30,
      },
    });
    installSuccessfulFetch(settings);
    render(<MarketingModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Park behind the salon.');

    fireEvent.change(screen.getByLabelText('Eight-week win-back discount'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save retention settings' }));

    expect(await screen.findByText('The eight-week offer must be at least as large as the six-week offer.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toHaveLength(0);
  });

  it('shows a load error and retries the same salon-scoped request', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'TEMPORARY', message: 'Temporary settings error' } }, 503))
      .mockResolvedValueOnce(settingsResponse(makeSettings()));

    render(<MarketingModal onClose={vi.fn()} />);

    expect(await screen.findByText('Temporary settings error')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByDisplayValue('Park behind the salon.')).toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/retention/settings?salonSlug=salon-a',
      '/api/admin/retention/settings?salonSlug=salon-a',
    ]);
  });
});
