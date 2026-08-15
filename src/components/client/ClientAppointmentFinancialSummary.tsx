import { formatMoney } from '@/libs/formatMoney';
import type { ClientAppointmentFinancialPresentation } from '@/types/clientAppointmentFinancial';

type ClientAppointmentFinancialSummaryProps = {
  financial: ClientAppointmentFinancialPresentation;
  className?: string;
};

export function ClientAppointmentFinancialSummary({
  financial,
  className = '',
}: ClientAppointmentFinancialSummaryProps) {
  if (financial.state === 'under_review') {
    return (
      <p
        className={`font-body text-xs text-[var(--n5-ink-muted)] ${className}`.trim()}
        data-testid="client-appointment-financial-under-review"
      >
        Financial details are under review. The salon will confirm the appointment total, deposit, and remaining balance.
      </p>
    );
  }

  const format = (cents: number) => `${formatMoney(cents, financial.currency)} ${financial.currency}`;
  const taxLineLabel = financial.taxApplied === true
    && financial.taxAmountCents !== null
    && financial.taxMode !== null
    ? `Estimated ${financial.taxLabel ?? 'tax'} (${financial.taxMode})`
    : null;

  const lines: Array<{ label: string; value: string }> = [
    { label: 'Estimated appointment total', value: format(financial.totalCents) },
  ];
  if (taxLineLabel && financial.taxAmountCents !== null) {
    lines.push({ label: taxLineLabel, value: format(financial.taxAmountCents) });
  }
  if (financial.collectedDepositCents > 0) {
    lines.push({ label: 'Deposit collected', value: format(financial.collectedDepositCents) });
  }
  if (financial.refundedDepositCents > 0) {
    lines.push({ label: 'Deposit refunded', value: format(financial.refundedDepositCents) });
  }
  if (financial.depositCreditCents > 0) {
    lines.push({
      label: 'Deposit credit toward appointment',
      value: `-${format(financial.depositCreditCents)}`,
    });
  }
  lines.push(
    { label: 'Amount already paid', value: format(financial.amountAlreadyPaidCents) },
    { label: 'Estimated remaining balance', value: format(financial.balanceCents) },
  );

  return (
    <dl
      className={`font-body grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-xs ${className}`.trim()}
      data-testid="client-appointment-financial-summary"
    >
      {lines.map(line => (
        <div className="contents" key={line.label}>
          <dt className="text-[var(--n5-ink-muted)]">{line.label}</dt>
          <dd className="text-right font-semibold tabular-nums text-[var(--n5-ink-main)]">
            {line.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
