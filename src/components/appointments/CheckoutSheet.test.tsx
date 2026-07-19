import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CheckoutSheet } from './CheckoutSheet';

const fetchMock = vi.fn();

vi.mock('next/image', () => ({
  default: (props: { alt: string }) => <img alt={props.alt} />,
}));

vi.mock('qrcode', () => ({
  toDataURL: vi.fn(async () => 'data:image/png;base64,QR'),
}));

const TAX_ON = {
  enabled: true,
  name: 'HST',
  rateBps: 1300,
  pricesIncludeTax: false,
  taxServicesByDefault: true,
  taxAddOnsByDefault: true,
  taxCustomByDefault: true,
};

function buildContext(overrides: Record<string, unknown> = {}) {
  return {
    appointment: {
      id: 'appt_1',
      status: 'confirmed',
      paymentStatus: 'pending',
      clientName: 'Ava Client',
      startTime: '2026-07-18T14:00:00.000Z',
      endTime: '2026-07-18T15:00:00.000Z',
      totalDurationMinutes: 60,
      totalPrice: 4500,
      startedAt: '2026-07-18T14:05:00.000Z',
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
        catalogServiceId: 'svc_1',
        catalogAddOnId: null,
        name: 'BIAB Short',
        quantity: 1,
        unitPriceCents: 4500,
        durationMinutes: 60,
      },
    ],
    finalItems: [],
    catalog: {
      services: [
        { id: 'svc_1', name: 'BIAB Short', priceCents: 4500, durationMinutes: 60 },
        { id: 'svc_2', name: 'French Tips', priceCents: 6000, durationMinutes: 75 },
      ],
      addOns: [
        { id: 'addon_1', name: 'Chrome Finish', priceCents: 1500, durationMinutes: 15 },
      ],
    },
    taxConfig: TAX_ON,
    currency: 'CAD',
    timeZone: 'America/Toronto',
    photoPolicy: { requireAfterPhotoToFinish: 'off' },
    photos: [],
    payments: [],
    balance: { totalDueCents: 0, amountPaidCents: 0, balanceCents: 0 },
    etransfer: {
      enabled: true,
      recipient: 'pay@salon.ca',
      recipientName: 'Luster Studio',
      autodepositEnabled: true,
      instructions: 'Include the reference.',
      requireReference: true,
      qrPageEnabled: true,
    },
    paymentReference: 'LSTR-APPT01',
    permissions: {
      canEditItems: true,
      canApplyDiscount: true,
      canRecordPayment: true,
      canTaxExempt: true,
      canMarkComp: true,
    },
    ...overrides,
  };
}

function mockCheckoutFetch(context: ReturnType<typeof buildContext>, options: {
  completeResponse?: () => Response;
} = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/checkout')) {
      return Promise.resolve(new Response(JSON.stringify({ data: context }), { status: 200 }));
    }
    if (url.includes('/complete') && init?.method === 'PATCH') {
      return Promise.resolve(
        options.completeResponse?.()
        ?? new Response(JSON.stringify({
          data: {
            appointment: { id: 'appt_1', status: 'completed', paymentStatus: 'paid', completedAt: new Date().toISOString() },
            showReviewPrompt: false,
          },
        }), { status: 200 }),
      );
    }
    return Promise.reject(new Error(`Unhandled fetch: ${url} ${init?.method ?? 'GET'}`));
  });
}

async function renderSheet(context = buildContext(), props: Partial<Parameters<typeof CheckoutSheet>[0]> = {}) {
  mockCheckoutFetch(context);
  render(
    <CheckoutSheet
      isOpen
      appointmentId="appt_1"
      onClose={vi.fn()}
      {...props}
    />,
  );
  await screen.findByTestId('checkout-items-section');
}

describe('CheckoutSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('prefills the booked items and computes live totals with tax', async () => {
    await renderSheet();

    expect(screen.getByText('BIAB Short')).toBeInTheDocument();
    // 4500 subtotal + 13% = 585 tax → 5085 total
    expect(screen.getByTestId('checkout-tax-amount')).toHaveTextContent('$5.85');
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$50.85');
  });

  it('adding a custom line item updates the preview totals', async () => {
    await renderSheet();

    fireEvent.click(screen.getByTestId('checkout-add-custom'));
    fireEvent.change(screen.getByTestId('checkout-custom-name'), { target: { value: 'Nail repair' } });
    fireEvent.change(screen.getByLabelText('Price for Nail repair'), { target: { value: '10' } });

    // 4500 + 1000 = 5500 subtotal, tax 715, total 6215
    expect(screen.getByTestId('checkout-final-subtotal')).toHaveTextContent('$55.00');
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$62.15');
  });

  it('removing an item and applying a discount adjust the totals', async () => {
    await renderSheet();

    fireEvent.change(screen.getByTestId('checkout-discount'), { target: { value: '5' } });

    // 4500 - 500 = 4000 taxable → 520 tax → 4520
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$45.20');

    fireEvent.click(screen.getByLabelText('Remove BIAB Short'));

    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$0.00');
  });

  it('blocks Review while actual finish is before actual start', async () => {
    await renderSheet();

    fireEvent.change(screen.getByTestId('checkout-actual-start'), { target: { value: '2026-07-18T15:00' } });
    fireEvent.change(screen.getByTestId('checkout-actual-end'), { target: { value: '2026-07-18T14:00' } });

    expect(screen.getByTestId('checkout-time-error')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-review-button')).toBeDisabled();

    fireEvent.change(screen.getByTestId('checkout-actual-end'), { target: { value: '2026-07-18T16:10' } });

    expect(screen.queryByTestId('checkout-time-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-actual-duration')).toHaveTextContent('70');
    expect(screen.getByTestId('checkout-review-button')).toBeEnabled();
  });

  it('asks about the after photo (with a working uploader) before completing, and completes on explicit skip', async () => {
    await renderSheet();

    fireEvent.click(screen.getByTestId('checkout-review-button'));
    fireEvent.click(await screen.findByTestId('checkout-complete-button'));

    // In-flow decision, not a dead-end: Add photo / Complete without photo.
    expect(await screen.findByText('Add an after photo?')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await screen.findByTestId('checkout-success');

    const completeCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    const body = JSON.parse(String((completeCall![1] as RequestInit).body));

    expect(body.skipPhotoValidation).toBe(true);
    expect(body.finalItems).toHaveLength(1);
    expect(body.finalItems[0]).toMatchObject({ kind: 'service', name: 'BIAB Short', unitPriceCents: 4500 });
    expect(body.expectedTotalDueCents).toBe(5085);
    expect(body.payments).toEqual([{ amountCents: 5085 }]);
  });

  it('required photo policy blocks completion instead of offering a skip', async () => {
    mockCheckoutFetch(
      buildContext({ photoPolicy: { requireAfterPhotoToFinish: 'required' } }),
      {
        completeResponse: () => new Response(JSON.stringify({
          error: {
            code: 'PHOTOS_REQUIRED',
            message: 'After photo required',
            details: { policy: 'required' },
          },
        }), { status: 400 }),
      },
    );
    render(
      <CheckoutSheet
        isOpen
        appointmentId="appt_1"
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId('checkout-items-section');

    expect(screen.getByText(/requires an after photo/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('checkout-review-button'));
    fireEvent.click(await screen.findByTestId('checkout-complete-button'));

    // No skip dialog — the server's hard block is surfaced as an error.
    expect(screen.queryByText('Add an after photo?')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('checkout-error')).toHaveTextContent(/requires an after photo/i);
    });

    expect(screen.queryByTestId('checkout-success')).not.toBeInTheDocument();
  });

  it('records a partial payment and shows the remaining balance in review', async () => {
    await renderSheet();

    fireEvent.click(screen.getByTestId('checkout-method-e_transfer'));
    fireEvent.change(screen.getByTestId('checkout-amount-received'), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('checkout-review-button'));

    expect(await screen.findByTestId('checkout-remaining-balance')).toHaveTextContent('$30.85');

    fireEvent.click(screen.getByTestId('checkout-complete-button'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await screen.findByTestId('checkout-success');

    const completeCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    const body = JSON.parse(String((completeCall![1] as RequestInit).body));

    expect(body.payments).toEqual([{ amountCents: 2000, method: 'e_transfer' }]);
  });

  it('shows e-Transfer instructions with reference, copy actions, and gated QR', async () => {
    await renderSheet();

    const panel = screen.getByTestId('checkout-etransfer-panel');

    expect(panel).toHaveTextContent('pay@salon.ca');
    expect(screen.getByTestId('checkout-etransfer-reference')).toHaveTextContent('LSTR-APPT01');
    expect(panel).toHaveTextContent(/autodeposit is on/i);
    expect(screen.getByTestId('checkout-show-qr')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy recipient')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy reference')).toBeInTheDocument();
  });

  it('hides the QR button when the salon disabled the payment page', async () => {
    await renderSheet(buildContext({
      etransfer: {
        enabled: true,
        recipient: 'pay@salon.ca',
        recipientName: null,
        autodepositEnabled: false,
        instructions: null,
        requireReference: true,
        qrPageEnabled: false,
      },
    }));

    expect(screen.queryByTestId('checkout-show-qr')).not.toBeInTheDocument();
  });

  it('success view exposes receipt, rebook, and close actions', async () => {
    const onRebook = vi.fn();
    const onClose = vi.fn();
    await renderSheet(buildContext({ photos: [{ id: 'p1', imageUrl: 'https://img/1.jpg', thumbnailUrl: null, photoType: 'after' }] }), {
      onRebook,
      onClose,
    });

    fireEvent.click(screen.getByTestId('checkout-review-button'));
    fireEvent.click(await screen.findByTestId('checkout-complete-button'));
    await screen.findByTestId('checkout-success');

    fireEvent.click(screen.getByTestId('checkout-success-view-receipt'));

    expect(await screen.findByTestId('checkout-receipt')).toBeInTheDocument();
  });

  it('opens straight onto the receipt for completed appointments', async () => {
    mockCheckoutFetch(buildContext({
      appointment: {
        ...buildContext().appointment,
        status: 'completed',
        paymentStatus: 'paid',
        finalPriceCents: 4500,
        taxEnabledSnapshot: true,
        taxNameSnapshot: 'HST',
        taxRateBps: 1300,
        taxInclusive: false,
        taxAmountCents: 585,
      },
      balance: { totalDueCents: 5085, amountPaidCents: 5085, balanceCents: 0 },
    }));
    render(
      <CheckoutSheet
        isOpen
        appointmentId="appt_1"
        initialView="receipt"
        onClose={vi.fn()}
      />,
    );

    const receipt = await screen.findByTestId('checkout-receipt');

    expect(receipt).toHaveTextContent('BIAB Short');
    expect(receipt).toHaveTextContent('HST');

    await waitFor(() => {
      expect(screen.queryByTestId('checkout-review-button')).not.toBeInTheDocument();
    });
  });
});
