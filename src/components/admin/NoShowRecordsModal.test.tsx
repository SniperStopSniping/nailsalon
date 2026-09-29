import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import messages from '@/locales/en.json';

import { NoShowRecordsModal } from './NoShowRecordsModal';

afterEach(() => vi.unstubAllGlobals());

describe('NoShowRecordsModal', () => {
  it('uses the selected salon and requires confirmation before correcting a no-show', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ page: 1, total: 1, platformActive: true, items: [{ appointmentId: 'appt_1', clientName: 'Ava', clientPhone: '••• 1234', clientEmail: null, appointmentStatus: 'no_show', cancelReason: 'no_show', updatedAt: '2026-09-29T12:00:00.000Z', startTime: '2026-09-29T10:00:00.000Z', endTime: '2026-09-29T11:00:00.000Z', eventId: null, eventState: null, eventEligible: false, countsForNetwork: false, expiresAt: null }] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NoShowRecordsModal salonSlug="salon-a" onClose={vi.fn()} />
      </NextIntlClientProvider>,
    );
    await screen.findByText('Ava');

    expect(fetchMock.mock.calls[0]?.[0]).toContain('salonSlug=salon-a');

    fireEvent.click(screen.getByRole('button', { name: 'Correct mistaken no-show' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const confirm = screen.getByRole('button', { name: 'Confirm correction' });

    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Why was this marked incorrectly?'), { target: { value: 'Client attended and we marked it by mistake.' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/correct?salonSlug=salon-a'), expect.objectContaining({ method: 'POST' })));
  });
});
