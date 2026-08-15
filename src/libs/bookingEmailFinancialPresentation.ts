import type { BookingEmailFinancialSummary } from '@/libs/bookingEmailFinancialSummary.server';
import { formatMoney } from '@/libs/formatMoney';

export type BookingEmailTaxPresentation = {
  taxAmountCents: number | null;
  taxLabel: string | null;
  taxMode: 'added' | 'included' | null;
  taxClassification: 'estimate' | 'actual' | null;
  taxApplied: boolean | null;
};

/**
 * Keep customer and salon transactional emails on one explicit tax vocabulary.
 * A missing applicable tax line may be disabled, exempt, or historical; callers
 * must never reconstruct one from mutable scalar/settings data.
 */
export function bookingEmailTaxLineLabel(
  summary: BookingEmailTaxPresentation,
): string | null {
  if (
    summary.taxApplied !== true
    || summary.taxAmountCents === null
    || summary.taxMode === null
    || summary.taxClassification === null
  ) {
    return null;
  }

  const classification = summary.taxClassification === 'actual'
    ? 'Actual'
    : 'Estimated';
  return `${classification} ${summary.taxLabel ?? 'Tax'} (${summary.taxMode})`;
}

export type BookingEmailFinancialLine = {
  label: string;
  value: string;
};

/**
 * Shared financial vocabulary for every booking-related email audience.
 * Callers receive no numeric lines when canonical tax/deposit/payment evidence
 * is absent or blocked, so none can fall back to legacy appointment scalars.
 */
export function buildBookingEmailFinancialLines(
  summary: BookingEmailFinancialSummary | null,
  options: { includeBlockedCode?: boolean } = {},
): BookingEmailFinancialLine[] {
  if (!summary || summary.depositBlockedCode) {
    const blockedCode = options.includeBlockedCode
      ? summary?.depositBlockedCode
      : null;
    return [
      {
        label: 'Payment details',
        value: blockedCode ? `Under review (${blockedCode})` : 'Under review',
      },
      {
        label: 'Payment update',
        value: 'The salon will confirm the final payment or refund status before any further action.',
      },
    ];
  }

  const terminalWithoutServiceInvoice = summary.appointmentStatus === 'cancelled'
    || summary.appointmentStatus === 'no_show';
  if (terminalWithoutServiceInvoice) {
    const lines: BookingEmailFinancialLine[] = [];
    if (summary.collectedDepositCents > 0) {
      lines.push({
        label: 'Deposit collected',
        value: formatMoney(summary.collectedDepositCents, summary.currency),
      });
    }
    if (summary.refundedDepositCents > 0) {
      lines.push({
        label: 'Deposit refunded',
        value: formatMoney(summary.refundedDepositCents, summary.currency),
      });
    }
    if (summary.forfeitedDepositCents > 0) {
      lines.push({
        label: 'Deposit retained',
        value: formatMoney(summary.forfeitedDepositCents, summary.currency),
      });
    }
    if (summary.depositPresentationState === 'refund_candidate') {
      lines.push({
        label: 'Deposit disposition',
        value: 'Refund decision required',
      });
    } else if (summary.depositPresentationState === 'refund_review') {
      lines.push({
        label: 'Deposit disposition',
        value: 'Under review',
      });
    }
    return lines;
  }

  const taxLineLabel = bookingEmailTaxLineLabel(summary);
  const lines: BookingEmailFinancialLine[] = taxLineLabel
    ? [{
        label: taxLineLabel,
        value: formatMoney(summary.taxAmountCents!, summary.currency),
      }]
    : [];
  lines.push({
    label: summary.taxClassification === 'actual'
      ? 'Invoice total'
      : 'Estimated appointment total',
    value: formatMoney(summary.totalDueCents, summary.currency),
  });
  if (summary.collectedDepositCents > 0) {
    lines.push({
      label: 'Deposit collected',
      value: formatMoney(summary.collectedDepositCents, summary.currency),
    });
  }
  if (summary.refundedDepositCents > 0) {
    lines.push({
      label: 'Deposit refunded',
      value: formatMoney(summary.refundedDepositCents, summary.currency),
    });
  }
  if (summary.forfeitedDepositCents > 0) {
    lines.push({
      label: 'Deposit retained',
      value: formatMoney(summary.forfeitedDepositCents, summary.currency),
    });
  }
  if (summary.depositCreditAppliedCents > 0) {
    lines.push({
      label: 'Deposit credit applied',
      value: `-${formatMoney(summary.depositCreditAppliedCents, summary.currency)}`,
    });
  }
  if (summary.appointmentPaymentsCents > 0) {
    lines.push({
      label: 'Other payments',
      value: formatMoney(summary.appointmentPaymentsCents, summary.currency),
    });
  }
  lines.push(
    {
      label: 'Amount already paid',
      value: formatMoney(summary.amountAlreadyPaidCents, summary.currency),
    },
    {
      label: summary.taxClassification === 'actual'
        ? 'Balance due'
        : 'Estimated remaining balance',
      value: formatMoney(summary.balanceCents, summary.currency),
    },
  );
  return lines;
}
