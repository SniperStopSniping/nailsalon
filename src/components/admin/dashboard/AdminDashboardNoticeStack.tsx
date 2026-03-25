import { CancelledBanner, SuspendedBanner, TrialBanner } from '@/components/admin/SuspendedBanner';

type AdminDashboardNoticeStackProps = {
  status: string | null | undefined;
  fraudSignalCount: number;
  onOpenFraudSignals: () => void;
};

export function AdminDashboardNoticeStack({
  status,
  fraudSignalCount,
  onOpenFraudSignals,
}: AdminDashboardNoticeStackProps) {
  return (
    <>
      {status === 'suspended' && (
        <SuspendedBanner
          message="Your salon is suspended. New bookings are disabled and changes cannot be made."
        />
      )}
      {status === 'cancelled' && (
        <CancelledBanner
          message="Your salon account has been cancelled. Please contact support to restore access."
        />
      )}
      {status === 'trial' && <TrialBanner daysRemaining={14} />}

      {fraudSignalCount > 0 && (
        <button
          type="button"
          onClick={onOpenFraudSignals}
          className="mx-4 mt-2 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3 transition-colors hover:bg-amber-100"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-amber-100">
              <span className="text-amber-600">⚠️</span>
            </div>
            <span className="text-sm font-medium text-amber-800">
              {fraudSignalCount}
              {' '}
              {fraudSignalCount === 1 ? 'activity' : 'activities'}
              {' '}
              flagged for review
            </span>
          </div>
          <span className="text-xs text-amber-600">Review →</span>
        </button>
      )}
    </>
  );
}
