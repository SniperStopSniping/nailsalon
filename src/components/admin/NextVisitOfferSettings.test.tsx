import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NextVisitOfferSettings } from './NextVisitOfferSettings';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

type ResponseArgs = { status?: number };
function response(body: unknown, { status = 200 }: ResponseArgs = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type TestSettings = {
  enabled: boolean;
  windowDays: number;
  discountType: 'percent' | 'fixed';
  value: number;
  eligibleServiceIds: string[];
  messageTemplate: string;
};

const settings: TestSettings = {
  enabled: false,
  windowDays: 30,
  discountType: 'percent' as const,
  value: 5,
  eligibleServiceIds: [],
  messageTemplate: 'Hi {{firstName}}, book within {{windowDays}} days for {{offer}}: {{bookingLink}}',
};
const availableServices = [{ id: 'gel', name: 'Gel manicure' }, { id: 'biab', name: 'BIAB' }];
const status = { enabledSince: null, issued: 3, reserved: 1, used: 2 };

function settingsResponse(overrides: Partial<typeof settings> = {}) {
  return response({ data: { settings: { ...settings, ...overrides }, availableServices, status } });
}

function patchBody() {
  const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

afterEach(() => {
  fetchMock.mockReset();
});

describe('NextVisitOfferSettings', () => {
  it('loads the default-safe configuration and keeps the save action disabled until changed', async () => {
    fetchMock.mockResolvedValueOnce(settingsResponse());
    render(<NextVisitOfferSettings salonSlug="isla" />);

    expect(await screen.findByText('Offer status')).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Turn on Next Visit Offer' })).not.toBeChecked();
    expect(screen.getByText('Issued').parentElement).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Save Next Visit Offer' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/next-visit-offer?salonSlug=isla', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  });

  it('saves the full canonical settings with a selected-service fixed offer', async () => {
    fetchMock.mockResolvedValueOnce(settingsResponse()).mockResolvedValueOnce(settingsResponse({ enabled: true, discountType: 'fixed', value: 750, eligibleServiceIds: ['gel'] }));
    render(<NextVisitOfferSettings salonSlug="isla" />);
    await screen.findByText('Offer details');

    fireEvent.click(screen.getByRole('switch', { name: 'Turn on Next Visit Offer' }));
    fireEvent.click(screen.getByLabelText('Fixed amount'));
    fireEvent.change(screen.getByLabelText('Discount amount'), { target: { value: '7.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selected services' }));
    fireEvent.click(screen.getByLabelText('Gel manicure'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Next Visit Offer' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(patchBody()).toEqual({
      enabled: true,
      windowDays: 30,
      discountType: 'fixed',
      value: 750,
      eligibleServiceIds: ['gel'],
      messageTemplate: settings.messageTemplate,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Next Visit Offer saved.');
  });

  it('keeps uncommon window values behind Custom and blocks invalid custom values before save', async () => {
    fetchMock.mockResolvedValueOnce(settingsResponse());
    render(<NextVisitOfferSettings salonSlug="isla" />);
    await screen.findByText('Offer details');

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom days'), { target: { value: '91' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Turn on Next Visit Offer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Next Visit Offer' }));

    expect(await screen.findByText('Choose a window from 1 to 90 days.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Custom days')).toHaveFocus();
  });

  it('retains drafts after a failed save and explains the no-new-offers behavior', async () => {
    fetchMock.mockResolvedValueOnce(settingsResponse()).mockResolvedValueOnce(response({ error: { message: 'Temporarily unavailable' } }, { status: 503 }));
    render(<NextVisitOfferSettings salonSlug="isla" />);
    await screen.findByText('Offer details');

    expect(screen.getByText(/Previously issued offers remain valid until their original deadline/)).toBeVisible();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Come back soon {{bookingLink}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Next Visit Offer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Temporarily unavailable');
    expect(screen.getByLabelText('Message')).toHaveValue('Come back soon {{bookingLink}}');
    expect(screen.getByRole('button', { name: 'Save Next Visit Offer' })).toBeEnabled();
  });

  it('does not show a stale first salon editor after a salon change', async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    fetchMock.mockImplementationOnce(() => oldResponse).mockResolvedValueOnce(settingsResponse({ messageTemplate: 'Nova {{bookingLink}}' }));
    const view = render(<NextVisitOfferSettings salonSlug="isla" />);
    view.rerender(<NextVisitOfferSettings salonSlug="nova" />);

    expect(await screen.findByDisplayValue('Nova {{bookingLink}}')).toBeVisible();

    resolveOld?.(settingsResponse({ messageTemplate: 'Old Isla {{bookingLink}}' }));
    await oldResponse;

    expect(screen.queryByDisplayValue('Old Isla {{bookingLink}}')).not.toBeInTheDocument();
  });

  it('lets an owner clear and type a fixed dollar amount before validation', async () => {
    fetchMock.mockResolvedValueOnce(settingsResponse());
    render(<NextVisitOfferSettings salonSlug="isla" />);
    await screen.findByText('Offer details');
    fireEvent.click(screen.getByLabelText('Fixed amount'));
    const input = screen.getByLabelText('Discount amount');
    fireEvent.change(input, { target: { value: '' } });

    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: '12.50' } });

    expect(input).toHaveValue('12.50');

    fireEvent.click(screen.getByRole('button', { name: 'Save Next Visit Offer' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(patchBody().value).toBe(1250);
  });
});
