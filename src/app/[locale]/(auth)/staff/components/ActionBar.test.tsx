import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionBar } from './ActionBar';

vi.mock('next/image', () => ({
  default: (props: { alt: string }) => <img alt={props.alt} />,
}));

const CHECKOUT_CONTEXT = {
  appointment: {
    id: 'appt_1',
    status: 'in_progress',
    paymentStatus: 'pending',
    clientName: 'Ava',
    startTime: '2026-03-20T10:00:00.000Z',
    endTime: '2026-03-20T11:15:00.000Z',
    totalDurationMinutes: 75,
    totalPrice: 6500,
    startedAt: '2026-03-20T10:02:00.000Z',
    completedAt: null,
    actualStartAt: null,
    actualEndAt: null,
    finalPriceCents: null,
    finalSubtotalCents: null,
    finalDiscountCents: null,
    finalDiscountReason: null,
    tipCents: 0,
    paymentMethod: null,
    taxEnabledSnapshot: null,
    taxNameSnapshot: null,
    taxRateBps: null,
    taxInclusive: null,
    taxAmountCents: null,
    taxableSubtotalCents: null,
    taxExempt: null,
    taxExemptReason: null,
  },
  bookedItems: [
    {
      kind: 'service',
      catalogServiceId: 'service_1',
      catalogAddOnId: null,
      name: 'BIAB Short',
      quantity: 1,
      unitPriceCents: 6500,
      durationMinutes: 75,
    },
  ],
  finalItems: [],
  catalog: { services: [], addOns: [] },
  taxConfig: {
    enabled: false,
    name: null,
    rateBps: 0,
    pricesIncludeTax: false,
    taxServicesByDefault: true,
    taxAddOnsByDefault: true,
    taxCustomByDefault: true,
  },
  currency: 'CAD',
  timeZone: 'America/Toronto',
  photoPolicy: { requireAfterPhotoToFinish: 'off' },
  photos: [{ id: 'photo_1', imageUrl: '/after.jpg', thumbnailUrl: null, photoType: 'after' }],
  payments: [],
  balance: { totalDueCents: 0, amountPaidCents: 0, balanceCents: 0 },
  etransfer: {
    enabled: false,
    recipient: null,
    recipientName: null,
    autodepositEnabled: false,
    instructions: null,
    requireReference: true,
    qrPageEnabled: false,
  },
  paymentReference: 'LSTR-APPT01',
  permissions: {
    canEditItems: true,
    canApplyDiscount: true,
    canRecordPayment: true,
    canTaxExempt: false,
    canMarkComp: false,
  },
};

describe('ActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the shared checkout flow and completes through the real completion route', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/checkout')) {
        return Promise.resolve(new Response(JSON.stringify({ data: CHECKOUT_CONTEXT }), { status: 200 }));
      }
      if (url.includes('/complete') && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            appointment: { id: 'appt_1', status: 'completed', paymentStatus: 'paid', completedAt: new Date().toISOString() },
            showReviewPrompt: false,
          },
        }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    vi.stubGlobal('fetch', fetchMock);

    const onClose = vi.fn();

    render(
      <ActionBar
        appointment={{
          id: 'appt_1',
          clientPhone: '+14165551234',
          status: 'in_progress',
          canvasState: 'working',
          technicianId: 'tech_1',
          clientName: 'Ava',
          startTime: '2026-03-20T10:00:00.000Z',
          endTime: '2026-03-20T11:15:00.000Z',
          totalPrice: 6500,
          services: [{ name: 'BIAB Short' }],
          photos: [{ id: 'photo_1', photoType: 'after', imageUrl: '/after.jpg', thumbnailUrl: null }],
        }}
        onOpenPhotos={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('staff-action-complete'));

    // The staff canvas now opens the SAME checkout sheet as every other surface.
    await screen.findByTestId('checkout-sheet');
    await screen.findByTestId('checkout-items-section');

    expect(screen.getByText('BIAB Short')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$65.00');

    fireEvent.click(screen.getByTestId('checkout-method-cash'));
    fireEvent.click(screen.getByTestId('checkout-review-button'));
    fireEvent.click(await screen.findByTestId('checkout-complete-button'));

    await waitFor(() => {
      const completeCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      );

      expect(completeCall).toBeTruthy();

      const body = JSON.parse(String((completeCall![1] as RequestInit).body));

      expect(body.finalItems).toEqual([
        expect.objectContaining({ kind: 'service', catalogServiceId: 'service_1', unitPriceCents: 6500 }),
      ]);
      expect(body.payments).toEqual([{ amountCents: 6500, method: 'cash' }]);
    });

    // showReviewPrompt=false → the canvas closes as before.
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('confirms appointment cancellation before one existing transition mutation', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();

    render(
      <ActionBar
        appointment={{
          id: 'appt_cancel',
          clientPhone: '+14165551234',
          status: 'confirmed',
          canvasState: 'waiting',
          technicianId: 'tech_1',
          clientName: 'Ava',
          startTime: '2026-03-20T10:00:00.000Z',
          endTime: '2026-03-20T11:15:00.000Z',
          totalPrice: 6500,
          services: [{ name: 'BIAB Short' }],
          photos: [],
        }}
        onOpenPhotos={vi.fn()}
        onClose={onClose}
      />,
    );

    const cancelAppointment = await screen.findByRole('button', { name: 'Cancel Appointment' });
    await user.click(cancelAppointment);

    expect(screen.getByText('Cancel Ava\'s appointment?')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('confirm-dialog-cancel'));
    await waitFor(() => expect(cancelAppointment).toHaveFocus());

    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(cancelAppointment);
    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith('/api/appointments/appt_cancel/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'cancelled' }),
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
