type NoShowProtection = 'warn_only' | 'deposit_1' | 'deposit_2';

export type BookingRisk =
  | {
    state: 'available';
    activeNoShowCount: number;
    windowMonths: 12;
    protection: NoShowProtection;
  }
  | {
    state: 'unavailable';
  };

function protectionCopy(protection: NoShowProtection): string {
  if (protection === 'deposit_1') {
    return 'Deposit required for eligible public bookings';
  }
  if (protection === 'deposit_2') {
    return 'Deposit required at 2 recorded no-shows';
  }
  return 'Warning only';
}

export function BookingRiskCard({ risk }: { risk: BookingRisk }) {
  if (risk.state === 'unavailable') {
    return (
      <div
        data-testid="booking-risk-unavailable"
        className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
      >
        <div className="text-[12px] font-medium uppercase text-stone-500">Booking Risk</div>
        <p className="mt-1 text-sm text-stone-600">Network no-show history unavailable.</p>
      </div>
    );
  }

  if (risk.activeNoShowCount <= 0) {
    return (
      <div
        data-testid="booking-risk-clear"
        className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
      >
        <div className="text-[12px] font-medium uppercase text-stone-500">Booking Risk</div>
        <p className="mt-1 text-sm text-stone-600">
          No recorded no-shows in the active risk window.
        </p>
      </div>
    );
  }

  const noShowLabel = risk.activeNoShowCount === 1 ? 'no-show' : 'no-shows';

  return (
    <div
      data-testid="booking-risk-warning"
      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950"
    >
      <div className="text-[12px] font-semibold uppercase text-amber-800">Booking Risk</div>
      <p className="mt-1 text-sm font-semibold">Higher no-show risk</p>
      <p className="mt-1 text-sm">
        {risk.activeNoShowCount}
        {' '}
        recorded
        {' '}
        {noShowLabel}
        {' '}
        on Luster in the last
        {' '}
        {risk.windowMonths}
        {' '}
        months.
      </p>
      <p className="mt-2 text-xs font-medium text-amber-900">
        No-show protection:
        {' '}
        {protectionCopy(risk.protection)}
      </p>
    </div>
  );
}
