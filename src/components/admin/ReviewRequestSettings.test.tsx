/* eslint-disable style/max-statements-per-line */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewRequestSettings } from './ReviewRequestSettings';

const fetchMock = vi.fn();
const settings = { googleReviewUrl: 'https://g.page/salon/review', automaticEnabled: false, delayMinutes: 60, messageTemplate: 'Hi {{firstName}}! {{reviewLink}}', businessName: 'Isla Nail Studio' };

describe('ReviewRequestSettings', () => {
  beforeEach(() => {
    fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('saves a review link without enabling automatic requests', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: settings }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: settings })));
    render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByDisplayValue('https://g.page/salon/review');
    fireEvent.change(screen.getByLabelText('Google review link'), { target: { value: 'https://example.com/reviews' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review settings' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ googleReviewUrl: 'https://example.com/reviews', automaticEnabled: false, delayMinutes: 60 });
  });

  it('restores the shared default message without changing automation', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: settings })));
    render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByDisplayValue('Hi {{firstName}}! {{reviewLink}}');
    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }));

    expect(screen.getByLabelText('Automatically request reviews')).not.toBeChecked();
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toContain('{{reviewLink}}');
  });
});
