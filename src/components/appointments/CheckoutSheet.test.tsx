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

function taxSnapshot(
  kind: 'booking_estimate' | 'final_actual',
  rateBps: number,
  capturedAt: string,
) {
  const base = {
    schemaVersion: 1,
    kind,
    classification: kind === 'booking_estimate' ? 'estimate' : 'actual',
    capturedAt,
    currency: 'CAD',
    configuration: {
      enabled: true,
      label: 'HST',
      rateBps,
      mode: 'added',
      configurationSource: 'base',
      configurationEffectiveFrom: null,
      jurisdiction: 'Ontario HST',
      country: 'CA',
      region: 'ON',
    },
    taxApplied: true,
    taxableSubtotalCents: 4500,
    taxAmountCents: Math.round(4500 * rateBps / 10000),
    serviceSubtotalCents: 4500,
    invoiceTotalCents: 4500 + Math.round(4500 * rateBps / 10000),
  };
  return kind === 'final_actual'
    ? { ...base, taxExempt: false, taxExemptReason: null }
    : base;
}

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
      discountAmountCents: null,
      discountLabel: null,
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

  it('keeps checkout in a bounded mobile scroll region between a fixed header and action bar', async () => {
    await renderSheet();

    const sheet = screen.getByTestId('checkout-sheet');
    const scrollRegion = screen.getByTestId('checkout-scroll-region');
    const actionBar = screen.getByTestId('checkout-action-bar');

    expect(sheet).toHaveClass('min-h-0', 'flex-1');
    expect(sheet.parentElement).toHaveClass('h-[92vh]', 'supports-[height:100dvh]:h-[92dvh]');
    expect(scrollRegion).toHaveClass('min-h-0', 'flex-1', 'touch-pan-y', 'overflow-y-auto', 'overscroll-contain');
    expect(actionBar).toHaveClass('shrink-0');
    expect(screen.getByTestId('checkout-close').parentElement?.parentElement).toHaveClass('shrink-0');
    expect(screen.getByRole('button', { name: 'Close checkout' })).toBeVisible();
    expect(screen.getByTestId('checkout-cancel')).toBeVisible();
    expect(screen.getByTestId('checkout-review-button')).toBeVisible();
  });

  it('closes immediately from Cancel when checkout is unchanged', async () => {
    const onClose = vi.fn();
    await renderSheet(buildContext(), { onClose });

    fireEvent.click(screen.getByTestId('checkout-cancel'));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText('Discard checkout changes?')).not.toBeInTheDocument();
  });

  it('warns before discarding changes from Cancel, close, or Escape', async () => {
    const onClose = vi.fn();
    await renderSheet(buildContext(), { onClose });

    fireEvent.change(screen.getByTestId('checkout-discount'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('checkout-cancel'));

    expect(screen.getByText('Discard checkout changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

    expect(screen.queryByText('Discard checkout changes?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close checkout' }));

    expect(screen.getByText('Discard checkout changes?')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByText('Discard checkout changes?')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Back beside Complete appointment in the persistent review action bar', async () => {
    await renderSheet();

    fireEvent.click(screen.getByTestId('checkout-review-button'));

    expect(screen.getByTestId('checkout-back')).toBeVisible();
    expect(screen.getByTestId('checkout-complete-button')).toBeVisible();
    expect(screen.getByTestId('checkout-back').closest('[data-testid="checkout-action-bar"]')).toBe(
      screen.getByTestId('checkout-action-bar'),
    );

    fireEvent.click(screen.getByTestId('checkout-back'));

    expect(screen.getByTestId('checkout-review-button')).toBeVisible();
  });

  it('preserves unsaved checkout fields while refreshing persisted photos', async () => {
    const contextWithPhoto = buildContext({
      photos: [{ id: 'photo_1', imageUrl: 'https://img/after.jpg', thumbnailUrl: null, photoType: 'after' }],
    });
    await renderSheet(contextWithPhoto);

    fireEvent.change(screen.getByTestId('checkout-discount'), { target: { value: '5' } });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/photos/photo_1') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify({ data: { id: 'photo_1' } }), { status: 200 }));
      }
      if (url.includes('/checkout')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: { ...contextWithPhoto, photos: [] },
        }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url} ${init?.method ?? 'GET'}`));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove after photo' }));

    await screen.findByTestId('checkout-photo-nudge');

    expect(screen.getByTestId('checkout-discount')).toHaveValue('5');
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

  it('defaults and caps payment now to the balance after an eligible deposit', async () => {
    await renderSheet(buildContext({
      photos: [{ id: 'p1', imageUrl: 'https://img/1.jpg', thumbnailUrl: null, photoType: 'after' }],
      depositCredit: {
        state: 'resolved',
        blockedCode: null,
        collectedCents: 2500,
        refundedCents: 0,
        eligibleCents: 2500,
      },
      balance: {
        serviceInvoiceTotalCents: 5085,
        totalDueCents: 5085,
        appointmentPaymentsCents: 0,
        depositCreditAppliedCents: 2500,
        amountAlreadyPaidCents: 2500,
        balanceCents: 2585,
        excessDepositCents: 0,
      },
    }));

    expect(screen.getByTestId('checkout-amount-received')).toHaveValue('25.85');
    expect(screen.getByTestId('checkout-deposit-paid')).toHaveTextContent('$25.00');

    // Even a larger manual entry is capped to the canonical remaining balance.
    fireEvent.change(screen.getByTestId('checkout-amount-received'), { target: { value: '999' } });
    fireEvent.click(screen.getByTestId('checkout-review-button'));

    expect(screen.getByTestId('checkout-already-paid')).toHaveTextContent('$25.00');
    expect(screen.getByTestId('checkout-receiving-now')).toHaveTextContent('$25.85');
    expect(screen.getByTestId('checkout-remaining-balance')).toHaveTextContent('$0.00');

    fireEvent.click(screen.getByTestId('checkout-complete-button'));
    await screen.findByTestId('checkout-success');

    const completeCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    const body = JSON.parse(String((completeCall![1] as RequestInit).body));

    expect(body.expectedTotalDueCents).toBe(5085);
    expect(body.payments).toEqual([{ amountCents: 2585 }]);
  });

  it('keeps a tip payable when the deposit covers the full service invoice', async () => {
    await renderSheet(buildContext({
      depositCredit: {
        state: 'resolved',
        blockedCode: null,
        collectedCents: 5085,
        refundedCents: 0,
        eligibleCents: 5085,
      },
      balance: {
        serviceInvoiceTotalCents: 5085,
        totalDueCents: 5085,
        appointmentPaymentsCents: 0,
        depositCreditAppliedCents: 5085,
        amountAlreadyPaidCents: 5085,
        balanceCents: 0,
        excessDepositCents: 0,
      },
    }));

    expect(screen.getByTestId('checkout-amount-received')).toHaveValue('0');

    fireEvent.change(screen.getByTestId('checkout-tip'), { target: { value: '10' } });

    expect(screen.getByTestId('checkout-amount-received')).toHaveValue('10');
    expect(screen.getByTestId('checkout-review-button')).toBeEnabled();

    fireEvent.click(screen.getByTestId('checkout-review-button'));

    expect(screen.getByTestId('checkout-already-paid')).toHaveTextContent('$50.85');
    expect(screen.getByTestId('checkout-receiving-now')).toHaveTextContent('$10.00');
    expect(screen.getByTestId('checkout-remaining-balance')).toHaveTextContent('$0.00');
  });

  it('blocks checkout and payment-link copy when deposit credit is unresolved', async () => {
    await renderSheet(buildContext({
      depositCredit: {
        state: 'blocked',
        blockedCode: 'REFUND_PENDING',
        collectedCents: 2500,
        refundedCents: 0,
        eligibleCents: 0,
      },
      balance: {
        serviceInvoiceTotalCents: 5085,
        totalDueCents: 5085,
        appointmentPaymentsCents: 0,
        depositCreditAppliedCents: 0,
        amountAlreadyPaidCents: 0,
        balanceCents: 5085,
        excessDepositCents: 0,
      },
    }));

    expect(screen.getByTestId('checkout-deposit-block')).toHaveTextContent('refund pending');
    expect(screen.getByTestId('checkout-review-button')).toBeDisabled();
    expect(screen.getByTestId('checkout-copy-amount')).toBeDisabled();
    expect(screen.getByTestId('checkout-show-qr')).toBeDisabled();
  });

  it('blocks historical money actions instead of guessing a mutable currency', async () => {
    await renderSheet(buildContext({ currency: null }));

    expect(screen.getByTestId('checkout-deposit-block')).toHaveTextContent(
      'no frozen invoice currency',
    );
    expect(screen.getByTestId('checkout-review-button')).toBeDisabled();
    expect(screen.getByTestId('checkout-copy-amount')).toBeDisabled();
    expect(screen.getByTestId('checkout-show-qr')).toBeDisabled();
  });

  it('accepts server-projected issue-time currency for an active legacy appointment with no money history', async () => {
    await renderSheet(buildContext({
      currency: 'CAD',
      appointment: {
        ...buildContext().appointment,
        invoiceCurrency: null,
        bookingTaxSnapshot: null,
        rescheduleTaxSnapshot: null,
        finalTaxSnapshot: null,
      },
      depositCredit: {
        state: 'resolved',
        blockedCode: null,
        collectedCents: 0,
        refundedCents: 0,
        eligibleCents: 0,
      },
    }));

    expect(screen.queryByTestId('checkout-deposit-block')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-review-button')).toBeEnabled();
  });

  it('blocks completion when eligible deposit money exceeds the edited invoice', async () => {
    await renderSheet(buildContext({
      depositCredit: {
        state: 'resolved',
        blockedCode: null,
        collectedCents: 6000,
        refundedCents: 0,
        eligibleCents: 6000,
      },
      balance: {
        serviceInvoiceTotalCents: 5085,
        totalDueCents: 5085,
        appointmentPaymentsCents: 0,
        depositCreditAppliedCents: 5085,
        amountAlreadyPaidCents: 5085,
        balanceCents: 0,
        excessDepositCents: 915,
      },
    }));

    expect(screen.getByTestId('checkout-deposit-block')).toHaveTextContent('$9.15');
    expect(screen.getByTestId('checkout-review-button')).toBeDisabled();
    expect(screen.getByTestId('checkout-amount-received')).toHaveValue('0');

    fireEvent.change(screen.getByLabelText('Price for BIAB Short'), {
      target: { value: '60' },
    });

    expect(screen.queryByTestId('checkout-deposit-block')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-review-button')).toBeEnabled();
    expect(screen.getByTestId('checkout-amount-received')).toHaveValue('7.80');
  });

  it('blocks persisted tender excess but lets a larger live invoice absorb it', async () => {
    await renderSheet(buildContext({
      depositCredit: {
        state: 'resolved',
        blockedCode: null,
        collectedCents: 2500,
        refundedCents: 0,
        eligibleCents: 2500,
      },
      balance: {
        serviceInvoiceTotalCents: 5085,
        totalDueCents: 5085,
        appointmentPaymentsCents: 5085,
        depositCreditAppliedCents: 2500,
        amountAlreadyPaidCents: 7585,
        balanceCents: 0,
        excessDepositCents: 0,
        tenderExcessCents: 2500,
      },
    }));

    expect(screen.getByTestId('checkout-deposit-block')).toHaveTextContent('$25.00');
    expect(screen.getByTestId('checkout-review-button')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Price for BIAB Short'), {
      target: { value: '75' },
    });

    expect(screen.queryByTestId('checkout-deposit-block')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-review-button')).toBeEnabled();
  });

  it('shows e-Transfer instructions but gates QR until the invoice is finalized', async () => {
    await renderSheet();

    const panel = screen.getByTestId('checkout-etransfer-panel');

    expect(panel).toHaveTextContent('pay@salon.ca');
    expect(screen.getByTestId('checkout-etransfer-reference')).toHaveTextContent('LSTR-APPT01');
    expect(panel).toHaveTextContent(/autodeposit is on/i);
    expect(screen.getByTestId('checkout-show-qr')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-show-qr')).toBeDisabled();
    expect(screen.getByTestId('checkout-show-qr')).toHaveTextContent('Complete appointment for QR');
    expect(screen.getByLabelText('Copy recipient')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy reference')).toBeInTheDocument();
  });

  it('enables the payment QR only for a finalized completed invoice', async () => {
    await renderSheet(buildContext({
      appointment: {
        ...buildContext().appointment,
        status: 'completed',
        completedAt: '2026-07-18T15:00:00.000Z',
        finalPriceCents: 4500,
        taxAmountCents: 585,
      },
    }));

    expect(screen.getByTestId('checkout-show-qr')).toBeEnabled();
    expect(screen.getByTestId('checkout-show-qr')).toHaveTextContent('Show payment QR');
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

  it('reuses the standalone-payment idempotency key when the same failed submission is retried', async () => {
    const initialContext = buildContext({
      photos: [{ id: 'p1', imageUrl: 'https://img/1.jpg', thumbnailUrl: null, photoType: 'after' }],
    });
    const completedContext = buildContext({
      appointment: {
        ...buildContext().appointment,
        status: 'completed',
        paymentStatus: 'pending',
        completedAt: '2026-07-18T15:00:00.000Z',
        finalPriceCents: 4500,
        taxAmountCents: 585,
      },
      balance: {
        serviceInvoiceTotalCents: 5085,
        totalDueCents: 5085,
        appointmentPaymentsCents: 0,
        depositCreditAppliedCents: 0,
        amountAlreadyPaidCents: 0,
        balanceCents: 5085,
        excessDepositCents: 0,
      },
    });
    let completed = false;
    const paymentBodies: Array<{ amountCents: number; idempotencyKey: string }> = [];
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/checkout')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: completed ? completedContext : initialContext,
        }), { status: 200 }));
      }
      if (url.includes('/complete') && init?.method === 'PATCH') {
        completed = true;
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            appointment: { id: 'appt_1', status: 'completed', paymentStatus: 'pending', completedAt: new Date().toISOString() },
            showReviewPrompt: false,
          },
        }), { status: 200 }));
      }
      if (url.includes('/payments') && init?.method === 'POST') {
        paymentBodies.push(JSON.parse(String(init.body)));
        return Promise.resolve(paymentBodies.length === 1
          ? new Response(JSON.stringify({ error: { message: 'Try again' } }), { status: 503 })
          : new Response(JSON.stringify({ data: { balanceCents: 4085 } }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url} ${init?.method ?? 'GET'}`));
    });
    render(<CheckoutSheet isOpen appointmentId="appt_1" onClose={vi.fn()} />);
    await screen.findByTestId('checkout-items-section');

    fireEvent.change(screen.getByTestId('checkout-amount-received'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('checkout-review-button'));
    fireEvent.click(screen.getByTestId('checkout-complete-button'));
    await screen.findByTestId('checkout-record-payment');

    fireEvent.change(screen.getByLabelText('Payment amount'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await screen.findByText('Try again');
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));

    await waitFor(() => expect(paymentBodies).toHaveLength(2));

    expect(paymentBodies[0]?.amountCents).toBe(1000);
    expect(paymentBodies[0]?.idempotencyKey).toMatch(/^checkout-payment-/);
    expect(paymentBodies[1]?.idempotencyKey).toBe(paymentBodies[0]?.idempotencyKey);
  });

  it('seeds a booked first-visit discount into the sheet when checkout opens', async () => {
    await renderSheet(buildContext({
      appointment: {
        ...buildContext().appointment,
        totalPrice: 3375,
        discountAmountCents: 1125,
        discountLabel: 'First visit discount',
      },
    }));

    expect(screen.getByTestId('checkout-discount')).toHaveValue('11.25');
    expect(screen.getByTestId('checkout-discount-reason')).toHaveValue('First visit discount');
    // 4500 − 1125 = 3375 taxable → 13% = 438.75 → 439 (half-up) → 3814 due
    expect(screen.getByTestId('checkout-tax-amount')).toHaveTextContent('$4.39');
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$38.14');
  });

  it('seeds a booked Smart Fit discount with tax applied after the discount (P7.2)', async () => {
    await renderSheet(buildContext({
      appointment: {
        ...buildContext().appointment,
        totalPrice: 4050,
        discountType: 'smart_fit',
        discountAmountCents: 450,
        discountLabel: 'Smart Fit Discount',
      },
    }));

    expect(screen.getByTestId('checkout-discount')).toHaveValue('4.50');
    expect(screen.getByTestId('checkout-discount-reason')).toHaveValue('Smart Fit Discount');
    // Discount before tax: 4500 − 450 = 4050 taxable → 13% = 526.5 → 527 (half-up) → 4577 due
    expect(screen.getByTestId('checkout-tax-amount')).toHaveTextContent('$5.27');
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$45.77');
  });

  it('seeds a booked reward discount and keeps it while items are edited', async () => {
    await renderSheet(buildContext({
      appointment: {
        ...buildContext().appointment,
        totalPrice: 4000,
        discountAmountCents: 500,
        discountLabel: 'Reward applied',
      },
    }));

    expect(screen.getByTestId('checkout-discount')).toHaveValue('5');
    // 4500 − 500 = 4000 taxable → 520 tax → 4520 due
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$45.20');

    // Add-on/custom edit: the seeded discount must survive.
    fireEvent.click(screen.getByTestId('checkout-add-custom'));
    fireEvent.change(screen.getByTestId('checkout-custom-name'), { target: { value: 'Nail repair' } });
    fireEvent.change(screen.getByLabelText('Price for Nail repair'), { target: { value: '10' } });

    expect(screen.getByTestId('checkout-discount')).toHaveValue('5');
    // 5500 − 500 = 5000 taxable → 650 tax → 5650 due
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$56.50');

    // Service price edit: still present, still applied exactly once.
    fireEvent.change(screen.getByLabelText('Price for BIAB Short'), { target: { value: '50' } });

    expect(screen.getByTestId('checkout-discount')).toHaveValue('5');
    // 5000 + 1000 − 500 = 5500 taxable → 715 tax → 6215 due
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$62.15');
  });

  it('seeds a booked campaign discount and sends it exactly once on completion', async () => {
    const context = buildContext({
      appointment: {
        ...buildContext().appointment,
        totalPrice: 4050,
        discountAmountCents: 450,
        discountLabel: 'We miss you — 10% off',
      },
      photos: [{ id: 'p1', imageUrl: 'https://img/1.jpg', thumbnailUrl: null, photoType: 'after' }],
    });
    await renderSheet(context);

    expect(screen.getByTestId('checkout-discount')).toHaveValue('4.50');
    expect(screen.getByTestId('checkout-discount-reason')).toHaveValue('We miss you — 10% off');

    fireEvent.click(screen.getByTestId('checkout-review-button'));
    fireEvent.click(await screen.findByTestId('checkout-complete-button'));
    await screen.findByTestId('checkout-success');

    const completeCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).includes('/complete') && (init as RequestInit)?.method === 'PATCH');

    expect(completeCall).toBeDefined();

    const body = JSON.parse((completeCall![1] as RequestInit).body as string);

    // The booked discount flows through as the single checkout discount.
    expect(body.discountCents).toBe(450);
    expect(body.discountReason).toBe('We miss you — 10% off');
    // 4500 − 450 = 4050 taxable → 526.5 → 527 (half-up) → 4577 due
    expect(body.expectedTotalDueCents).toBe(4577);
  });

  it('a seeded discount larger than the edited subtotal clamps to zero, never negative', async () => {
    await renderSheet(buildContext({
      appointment: {
        ...buildContext().appointment,
        totalPrice: 0,
        discountAmountCents: 5000,
        discountLabel: 'Reward applied',
      },
    }));

    fireEvent.click(screen.getByLabelText('Remove BIAB Short'));

    // Subtotal 0, discount clamped to 0 → no negative taxable base, no tax.
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$0.00');
  });

  it('a prior itemized checkout wins over the booked discount on reopen (including explicit zero)', async () => {
    await renderSheet(buildContext({
      appointment: {
        ...buildContext().appointment,
        discountAmountCents: 1125,
        discountLabel: 'First visit discount',
        finalDiscountCents: 200,
        finalDiscountReason: 'Price correction',
      },
    }));

    expect(screen.getByTestId('checkout-discount')).toHaveValue('2');
    expect(screen.getByTestId('checkout-discount-reason')).toHaveValue('Price correction');
  });

  it('an explicit zero discount from a prior checkout is not resurrected by the booked discount', async () => {
    await renderSheet(buildContext({
      appointment: {
        ...buildContext().appointment,
        discountAmountCents: 1125,
        discountLabel: 'First visit discount',
        finalDiscountCents: 0,
        finalDiscountReason: null,
      },
    }));

    expect(screen.getByTestId('checkout-discount')).toHaveValue('');
    // 4500 taxable, no discount → 585 tax → 5085 due (undiscounted)
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$50.85');
  });

  it('an appointment without a booked discount opens with an empty discount, unchanged', async () => {
    await renderSheet();

    expect(screen.getByTestId('checkout-discount')).toHaveValue('');
    expect(screen.getByTestId('checkout-discount-reason')).toHaveValue('');
    expect(screen.getByTestId('checkout-total-due')).toHaveTextContent('$50.85');
  });

  it('discloses when the final tax configuration differs from the booking estimate', async () => {
    await renderSheet(buildContext({
      appointment: {
        ...buildContext().appointment,
        bookingTaxSnapshot: taxSnapshot(
          'booking_estimate',
          1300,
          '2026-07-01T12:00:00.000Z',
        ),
      },
      taxConfig: { ...TAX_ON, rateBps: 1500 },
    }));

    const notice = screen.getByTestId('checkout-tax-configuration-change');

    expect(notice).toHaveTextContent('Booking estimate: HST 13%');
    expect(notice).toHaveTextContent('Final invoice: HST 15%');
    expect(notice).toHaveTextContent('before the deposit payment credit');
  });

  it('compares checkout tax to the latest reschedule estimate, not stale original history', async () => {
    await renderSheet(buildContext({
      appointment: {
        ...buildContext().appointment,
        bookingTaxSnapshot: taxSnapshot(
          'booking_estimate',
          500,
          '2026-07-01T12:00:00.000Z',
        ),
        rescheduleTaxSnapshot: taxSnapshot(
          'booking_estimate',
          1300,
          '2026-07-10T12:00:00.000Z',
        ),
      },
      taxConfig: { ...TAX_ON, rateBps: 1500 },
    }));

    const notice = screen.getByTestId('checkout-tax-configuration-change');

    expect(notice).toHaveTextContent('Booking estimate: HST 13%');
    expect(notice).not.toHaveTextContent('Booking estimate: HST 5%');
    expect(notice).toHaveTextContent('Final invoice: HST 15%');
  });

  it('renders receipt tax identity from the validated final snapshot, not legacy scalars', async () => {
    mockCheckoutFetch(buildContext({
      appointment: {
        ...buildContext().appointment,
        status: 'completed',
        paymentStatus: 'paid',
        finalPriceCents: 4500,
        taxEnabledSnapshot: true,
        taxNameSnapshot: 'GST',
        taxRateBps: 500,
        taxInclusive: true,
        taxAmountCents: 585,
        finalTaxSnapshot: taxSnapshot(
          'final_actual',
          1300,
          '2026-07-18T15:00:00.000Z',
        ),
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

    const taxLine = await screen.findByTestId('checkout-receipt-tax-line');

    expect(taxLine).toHaveTextContent('HST (13%)');
    expect(taxLine).not.toHaveTextContent('GST');
    expect(taxLine).not.toHaveTextContent('included');
    expect(taxLine).toHaveTextContent('$5.85');
  });

  it('the receipt shows the finalized discount with its honest label', async () => {
    mockCheckoutFetch(buildContext({
      appointment: {
        ...buildContext().appointment,
        status: 'completed',
        paymentStatus: 'paid',
        finalPriceCents: 3375,
        finalSubtotalCents: 4500,
        finalDiscountCents: 1125,
        finalDiscountReason: 'First visit discount',
        taxEnabledSnapshot: true,
        taxNameSnapshot: 'HST',
        taxRateBps: 1300,
        taxInclusive: false,
        taxAmountCents: 439,
      },
      balance: { totalDueCents: 3814, amountPaidCents: 3814, balanceCents: 0 },
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

    expect(receipt).toHaveTextContent('Discount (First visit discount)');
    expect(receipt).toHaveTextContent('$11.25');
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

  it('uses the frozen final tax snapshot in a receipt after settings change again', async () => {
    mockCheckoutFetch(buildContext({
      appointment: {
        ...buildContext().appointment,
        status: 'completed',
        paymentStatus: 'paid',
        finalPriceCents: 4500,
        taxEnabledSnapshot: true,
        taxNameSnapshot: 'HST',
        taxRateBps: 1500,
        taxInclusive: false,
        taxAmountCents: 675,
        bookingTaxSnapshot: taxSnapshot(
          'booking_estimate',
          1300,
          '2026-07-01T12:00:00.000Z',
        ),
        rescheduleTaxSnapshot: taxSnapshot(
          'booking_estimate',
          1400,
          '2026-07-10T12:00:00.000Z',
        ),
        finalTaxSnapshot: taxSnapshot(
          'final_actual',
          1500,
          '2026-07-18T15:00:00.000Z',
        ),
      },
      // Mutable settings have moved again; the receipt must ignore them.
      taxConfig: { ...TAX_ON, rateBps: 2000 },
      balance: { totalDueCents: 5175, amountPaidCents: 5175, balanceCents: 0 },
    }));
    render(
      <CheckoutSheet
        isOpen
        appointmentId="appt_1"
        initialView="receipt"
        onClose={vi.fn()}
      />,
    );

    const notice = await screen.findByTestId('checkout-receipt-tax-configuration-change');

    expect(notice).toHaveTextContent('Booking estimate: HST 14%');
    expect(notice).toHaveTextContent('Final invoice: HST 15%');
    expect(notice).not.toHaveTextContent('20%');
  });

  it('keeps deposit, refund, other-payment, paid, and balance receipt values consistent', async () => {
    mockCheckoutFetch(buildContext({
      appointment: {
        ...buildContext().appointment,
        status: 'completed',
        paymentStatus: 'partially_paid',
        finalPriceCents: 4500,
        taxEnabledSnapshot: true,
        taxNameSnapshot: 'HST',
        taxRateBps: 1300,
        taxInclusive: false,
        taxAmountCents: 585,
      },
      depositCredit: {
        state: 'resolved',
        blockedCode: null,
        collectedCents: 2500,
        refundedCents: 500,
        eligibleCents: 2000,
      },
      balance: {
        serviceInvoiceTotalCents: 5085,
        totalDueCents: 5085,
        appointmentPaymentsCents: 1000,
        depositCreditAppliedCents: 2000,
        amountAlreadyPaidCents: 3000,
        balanceCents: 2085,
        excessDepositCents: 0,
      },
    }));
    render(
      <CheckoutSheet
        isOpen
        appointmentId="appt_1"
        initialView="receipt"
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId('checkout-receipt');

    expect(screen.getByTestId('checkout-receipt-deposit-paid')).toHaveTextContent('$25.00');
    expect(screen.getByTestId('checkout-receipt-deposit-refunded')).toHaveTextContent('$5.00');
    expect(screen.getByTestId('checkout-receipt-other-payments')).toHaveTextContent('$10.00');
    expect(screen.getByTestId('checkout-receipt-already-paid')).toHaveTextContent('$30.00');
    expect(screen.getByTestId('checkout-receipt-balance')).toHaveTextContent('$20.85');
  });

  it.each([
    ['pending refund', 'DEPOSIT_REFUND_IN_FLIGHT'],
    ['failed refund', 'DEPOSIT_REFUND_UNRESOLVED'],
    ['unreconciled deposit', 'DEPOSIT_RECONCILIATION_REQUIRED'],
    ['late-deposit overpayment', 'APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED'],
  ])('fails the receipt closed for a %s', async (_state, blockedCode) => {
    mockCheckoutFetch(buildContext({
      appointment: {
        ...buildContext().appointment,
        status: 'completed',
        paymentStatus: 'partially_paid',
        finalPriceCents: 4500,
        taxEnabledSnapshot: true,
        taxNameSnapshot: 'HST',
        taxRateBps: 1300,
        taxInclusive: false,
        taxAmountCents: 585,
      },
      depositCredit: {
        state: 'blocked',
        blockedCode,
        collectedCents: 2500,
        refundedCents: 0,
        eligibleCents: 0,
      },
      // These tempting values must never become definitive receipt amounts
      // while the server says the deposit/refund state is unresolved.
      balance: {
        serviceInvoiceTotalCents: 5085,
        totalDueCents: 5085,
        appointmentPaymentsCents: 1000,
        depositCreditAppliedCents: 0,
        amountAlreadyPaidCents: 1000,
        balanceCents: 4085,
        excessDepositCents: 0,
      },
    }));
    render(
      <CheckoutSheet
        isOpen
        appointmentId="appt_1"
        initialView="receipt"
        onClose={vi.fn()}
      />,
    );

    const review = await screen.findByTestId('checkout-receipt-financial-review');

    expect(review).toHaveTextContent('Payment totals are under review');
    expect(screen.queryByTestId('checkout-receipt-other-payments')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-receipt-already-paid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-receipt-balance')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-receipt-deposit-paid')).toHaveTextContent('$25.00');
  });
});
