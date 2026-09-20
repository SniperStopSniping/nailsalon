import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_NEXT_VISIT_OFFER_SETTINGS } from '@/libs/nextVisitOffer';

import { NextVisitOfferRebook } from './NextVisitOfferRebook';

afterEach(() => vi.unstubAllGlobals());

describe('private completed-visit offer', () => {
  it('stays quiet when no offer exists and never mints a link on opening', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { offer: null } }) });
    vi.stubGlobal('fetch', fetcher);
    render(<NextVisitOfferRebook token="private-capability" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('method');
  });

  it('shows the authoritative window and only requests a link after explicit rebook', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { offer: { deadlineDate: '2026-10-20', currency: 'CAD', settings: { ...DEFAULT_NEXT_VISIT_OFFER_SETTINGS, value: 7 } } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { offer: null } }) });
    vi.stubGlobal('fetch', fetcher);
    render(<NextVisitOfferRebook token="private-capability" />);
    const button = await screen.findByRole('button', { name: 'Rebook with this offer' });

    expect(screen.getByText(/Save 7%.*2026-10-20/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);

    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(fetcher).toHaveBeenLastCalledWith('/api/public/appointments/manage/private-capability/next-visit-offer', { method: 'POST' });
  });
});
