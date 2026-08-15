/* eslint-disable import/first */
/**
 * Private appointment-management routing.
 *
 * The behaviours under test are security properties as much as UX ones: a bad
 * token must produce a truthful error page, never a redirect into the ordinary
 * public booking flow, and never a hint about which appointments exist.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyAppointmentAccessToken,
  describeAppointmentAccessFailure,
  loadBookingEmailFinancialSummary,
  selectResults,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  return {
    verifyAppointmentAccessToken: vi.fn(),
    describeAppointmentAccessFailure: vi.fn(),
    loadBookingEmailFinancialSummary: vi.fn(),
    selectResults,
  };
});

vi.mock('server-only', () => ({}));

vi.mock('@/libs/appointmentAccess', () => ({
  verifyAppointmentAccessToken,
  describeAppointmentAccessFailure,
}));

vi.mock('@/libs/bookingEmailFinancialSummary.server', () => ({
  loadBookingEmailFinancialSummary,
}));

vi.mock('@/libs/DB', () => {
  const chain = () => {
    const target: Record<string, unknown> = {};
    target.from = () => target;
    target.where = () => {
      const rows = selectResults.shift() ?? [];
      return Object.assign(Promise.resolve(rows), {
        limit: async () => rows,
      });
    };
    return target;
  };
  return { db: { select: chain } };
});

import { ManageAppointmentView } from './ManageAppointmentView';

const TOKEN = 'TEST_TOKEN_NOT_A_REAL_CAPABILITY';
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function capability(overrides: Record<string, unknown> = {}) {
  const startTime = new Date('2026-08-31T18:00:00.000Z');
  const appointmentOverrides = overrides.appointment as Record<string, unknown> | undefined;
  const { appointment: _appointment, ...capabilityOverrides } = overrides;
  return {
    tokenId: 'token_1',
    appointmentId: 'appt_1',
    salonId: 'salon_1',
    expiresAt: FUTURE,
    salonSlug: 'isla-nail-studio1',
    salonName: 'Isla Nail Studio1',
    salonEmail: 'salon@example.com',
    salonPhone: '4165551234',
    salonSettings: { booking: { clientChangeCutoffHours: 0, timezone: 'America/Toronto' } },
    appointment: {
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      locationId: null,
      clientName: 'Daniel',
      clientEmail: 'daniel@example.com',
      status: 'confirmed',
      invoiceCurrency: 'CAD',
      startTime,
      endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
      totalPrice: 4500,
      totalDurationMinutes: 60,
      subtotalBeforeDiscountCents: 5000,
      discountAmountCents: 500,
      discountLabel: 'Smart Fit saving',
      ...appointmentOverrides,
    },
    ...capabilityOverrides,
  };
}

async function renderPage(params: { locale: string; slug: string; token: string }) {
  render(await ManageAppointmentView(params));
}

describe('appointment management page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    describeAppointmentAccessFailure.mockResolvedValue('invalid');
    loadBookingEmailFinancialSummary.mockResolvedValue({
      currency: 'CAD',
      serviceInvoiceTotalCents: 4500,
      totalDueCents: 4500,
      collectedDepositCents: 0,
      refundedDepositCents: 0,
      forfeitedDepositCents: 0,
      depositCreditAppliedCents: 0,
      appointmentPaymentsCents: 0,
      amountAlreadyPaidCents: 0,
      balanceCents: 4500,
      depositBlockedCode: null,
      depositPresentationState: 'none',
    });
  });

  it('loads the appointment behind a valid token', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(capability());
    selectResults.push(
      [{ name: 'Russian Manicure' }],
      [{ name: 'Chrome finish', quantity: 1, lineTotalCents: 1000 }],
      [{ name: 'Daniela' }],
    );

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(screen.getByText(/Russian Manicure/)).toBeInTheDocument();
    expect(screen.getByText(/Chrome finish/)).toBeInTheDocument();
    expect(screen.getByText('Daniela')).toBeInTheDocument();
    expect(screen.getByTestId('appointment-status')).toHaveTextContent('Confirmed');
    expect(screen.getByText(/Smart Fit saving/)).toBeInTheDocument();
    expect(screen.getAllByText('$45.00 CAD')).toHaveLength(2);
  });

  it('keeps the token on the reschedule and calendar links', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(capability());
    selectResults.push([{ name: 'Russian Manicure' }], [], [{ name: 'Daniela' }]);

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(screen.getByRole('link', { name: /Choose a new time/i }))
      .toHaveAttribute('href', `/en/isla-nail-studio1/manage/${TOKEN}/reschedule`);
    expect(screen.getByRole('link', { name: /Apple Calendar/i }))
      .toHaveAttribute('href', `/en/isla-nail-studio1/manage/${TOKEN}/calendar.ics`);
  });

  it('shows the canonical deposit credit and remaining balance', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(capability());
    loadBookingEmailFinancialSummary.mockResolvedValue({
      currency: 'CAD',
      serviceInvoiceTotalCents: 5085,
      totalDueCents: 5085,
      collectedDepositCents: 2500,
      refundedDepositCents: 0,
      forfeitedDepositCents: 0,
      depositCreditAppliedCents: 2500,
      appointmentPaymentsCents: 0,
      amountAlreadyPaidCents: 2500,
      balanceCents: 2585,
      depositBlockedCode: null,
      depositPresentationState: 'creditable',
    });
    selectResults.push([{ name: 'Russian Manicure' }], [], [{ name: 'Daniela' }]);

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(screen.getByText('$50.85 CAD')).toBeInTheDocument();
    expect(screen.getByTestId('manage-deposit-paid')).toHaveTextContent('$25.00');
    expect(screen.getByTestId('manage-deposit-credit')).toHaveTextContent('−$25.00');
    expect(screen.getByTestId('manage-already-paid')).toHaveTextContent('$25.00');
    expect(screen.getByTestId('manage-balance')).toHaveTextContent('$25.85');
  });

  it('shows an added-tax deposit hold as a full estimate with zero credit and a separate amount due', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(capability({
      appointment: {
        status: 'awaiting_payment',
        totalPrice: 10000,
        subtotalBeforeDiscountCents: 10000,
        discountAmountCents: 0,
        discountLabel: null,
      },
    }));
    loadBookingEmailFinancialSummary.mockResolvedValue({
      currency: 'CAD',
      serviceInvoiceTotalCents: 11300,
      totalDueCents: 11300,
      taxAmountCents: 1300,
      taxLabel: 'HST',
      taxMode: 'added',
      taxClassification: 'estimate',
      taxApplied: true,
      collectedDepositCents: 0,
      refundedDepositCents: 0,
      forfeitedDepositCents: 0,
      depositCreditAppliedCents: 0,
      appointmentPaymentsCents: 0,
      amountAlreadyPaidCents: 0,
      balanceCents: 11300,
      depositBlockedCode: null,
      depositPresentationState: 'none',
    });
    selectResults.push(
      [{ name: 'Russian Manicure' }],
      [],
      [{ name: 'Daniela' }],
      [{ amountCents: 2500, currency: 'cad', checkoutUrl: 'https://checkout.example/hold' }],
    );

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(loadBookingEmailFinancialSummary).toHaveBeenCalledWith({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
    });
    expect(screen.getByTestId('appointment-status')).toHaveTextContent('Awaiting deposit');
    expect(screen.getByText('Estimated total').nextSibling).toHaveTextContent('$113.00 CAD');
    expect(screen.queryByText('$100.00 CAD')).not.toBeInTheDocument();
    expect(screen.getByTestId('manage-deposit-credit')).toHaveTextContent('$0.00 CAD');
    expect(screen.getByTestId('manage-deposit-due')).toHaveTextContent('$25.00 CAD');
    expect(screen.getByTestId('manage-already-paid')).toHaveTextContent('$0.00 CAD');
    expect(screen.getByTestId('manage-balance')).toHaveTextContent('$113.00 CAD');
    expect(screen.getByRole('link', { name: 'Resume payment' })).toHaveAttribute(
      'href',
      'https://checkout.example/hold',
    );
  });

  it.each([
    {
      name: 'the hold currency differs from the frozen invoice',
      amountCents: 2500,
      currency: 'cad',
      invoiceCurrency: 'USD',
    },
    {
      name: 'the hold amount exceeds the canonical balance',
      amountCents: 11_301,
      currency: 'cad',
      invoiceCurrency: 'CAD',
    },
  ])('hides the stored checkout URL when $name', async ({
    amountCents,
    currency,
    invoiceCurrency,
  }) => {
    verifyAppointmentAccessToken.mockResolvedValue(capability({
      appointment: {
        status: 'awaiting_payment',
        invoiceCurrency,
        totalPrice: 10000,
        subtotalBeforeDiscountCents: 10000,
        discountAmountCents: 0,
        discountLabel: null,
      },
    }));
    loadBookingEmailFinancialSummary.mockResolvedValue({
      currency: invoiceCurrency,
      serviceInvoiceTotalCents: 11300,
      totalDueCents: 11300,
      taxAmountCents: 1300,
      taxLabel: 'HST',
      taxMode: 'added',
      taxClassification: 'estimate',
      taxApplied: true,
      collectedDepositCents: 0,
      refundedDepositCents: 0,
      forfeitedDepositCents: 0,
      depositCreditAppliedCents: 0,
      appointmentPaymentsCents: 0,
      amountAlreadyPaidCents: 0,
      balanceCents: 11300,
      depositBlockedCode: null,
      depositPresentationState: 'none',
    });
    selectResults.push(
      [{ name: 'Russian Manicure' }],
      [],
      [{ name: 'Daniela' }],
      [{ amountCents, currency, checkoutUrl: 'https://checkout.example/unsafe-hold' }],
    );

    const { container } = render(await ManageAppointmentView({
      locale: 'en',
      slug: 'isla-nail-studio1',
      token: TOKEN,
    }));

    expect(screen.queryByRole('link', { name: 'Resume payment' })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('https://checkout.example/unsafe-hold');
    expect(screen.getByText(/Financial details are under review/i)).toBeInTheDocument();
  });

  it('shows no-show forfeiture without treating it as appointment credit', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(capability({
      appointment: { status: 'no_show' },
    }));
    loadBookingEmailFinancialSummary.mockResolvedValue({
      currency: 'CAD',
      serviceInvoiceTotalCents: 0,
      totalDueCents: 0,
      collectedDepositCents: 2500,
      refundedDepositCents: 0,
      forfeitedDepositCents: 2500,
      depositCreditAppliedCents: 0,
      appointmentPaymentsCents: 0,
      amountAlreadyPaidCents: 0,
      balanceCents: 0,
      depositBlockedCode: null,
      depositPresentationState: 'forfeited',
    });
    selectResults.push([{ name: 'Russian Manicure' }], [], [{ name: 'Daniela' }]);

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(screen.getByTestId('appointment-status')).toHaveTextContent('No-show');
    expect(screen.getByText('Deposit retained after no-show.')).toBeInTheDocument();
    expect(screen.queryByText('Deposit payment credit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('manage-balance')).not.toBeInTheDocument();
  });

  it('fails closed when a historical appointment has no frozen currency', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(capability({
      appointment: { invoiceCurrency: null },
    }));
    loadBookingEmailFinancialSummary.mockResolvedValue(null);
    selectResults.push([{ name: 'Russian Manicure' }], [], [{ name: 'Daniela' }]);

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$45\.00/)).not.toBeInTheDocument();
  });

  it('shows a truthful error for an invalid token and never opens booking', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(null);

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: 'bogus' });

    expect(screen.getByText('This link is not valid')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Choose a new time/i })).not.toBeInTheDocument();

    const hrefs = screen.getAllByRole('link').map(link => link.getAttribute('href') ?? '');

    expect(hrefs.some(href => /\/book(?:\/|$)/.test(href))).toBe(false);
  });

  /**
   * Regression (browser QA): verifyAppointmentAccessToken filters expiry in
   * SQL, so an expired link resolves to null exactly like a bogus one. Without
   * the dedicated lookup the customer is told their link is invalid and goes
   * hunting for a typo that does not exist.
   */
  it('shows a distinct expired-link error rather than the generic one', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(null);
    describeAppointmentAccessFailure.mockResolvedValue('expired');

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(screen.getByText('This link has expired')).toBeInTheDocument();
    expect(screen.queryByText('This link is not valid')).not.toBeInTheDocument();
  });

  it('keeps a revoked or unknown token on the generic invalid message', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(null);
    describeAppointmentAccessFailure.mockResolvedValue('invalid');

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(screen.getByText('This link is not valid')).toBeInTheDocument();
  });

  it('rejects a token whose salon does not match the slug in the URL', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(capability({ salonSlug: 'another-salon' }));

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(screen.getByText('This link is not valid')).toBeInTheDocument();
    // Nothing about the real salon or appointment leaks.
    expect(screen.queryByText(/Isla Nail Studio1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/appt_1/)).not.toBeInTheDocument();
  });

  it('rejects a token whose appointment belongs to a different salon', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(
      capability({ appointment: { salonId: 'salon_other' } }),
    );

    await renderPage({ locale: 'en', slug: 'isla-nail-studio1', token: TOKEN });

    expect(screen.getByText('This link is not valid')).toBeInTheDocument();
  });

  it('never prints the raw token in the page body', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(capability());
    selectResults.push([{ name: 'Russian Manicure' }], [], [{ name: 'Daniela' }]);

    const { container } = render(await ManageAppointmentView({
      locale: 'en',
      slug: 'isla-nail-studio1',
      token: TOKEN,
    }));

    // The token belongs in the URL only — never rendered as page copy.
    // eslint-disable-next-line jest-dom/prefer-to-have-text-content
    expect(container.textContent).not.toContain(TOKEN);
  });

  it('is marked noindex', async () => {
    const { metadata } = await import('./page');

    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
