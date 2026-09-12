/* eslint-disable style/max-statements-per-line */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewRequestSuppression } from './ReviewRequestSuppression';

const fetchMock = vi.fn();

describe('ReviewRequestSuppression', () => {
  beforeEach(() => {
    fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('persists client suppression through the review-preferences endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { reviewRequestsSuppressed: false } }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: { reviewRequestsSuppressed: true } })));
    render(<ReviewRequestSuppression salonSlug="isla" clientId="client_1" />);
    const control = await screen.findByRole('checkbox', { name: 'Do not send review requests' });
    fireEvent.click(control);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/admin/clients/client_1/review-requests?salonSlug=isla');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ reviewRequestsSuppressed: true });
    expect(await screen.findByText('Pending review requests are cancelled.')).toBeVisible();
  });
});
