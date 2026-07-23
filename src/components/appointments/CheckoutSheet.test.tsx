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
});
