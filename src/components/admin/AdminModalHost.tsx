import { AnalyticsWidgets, type TimePeriod } from '@/components/admin/AnalyticsWidgets';
import { type AppId } from '@/components/admin/AppGrid';
import { AppModal } from '@/components/admin/AppModal';
import { AppointmentsModal } from '@/components/admin/AppointmentsModal';
import { ClientsModal } from '@/components/admin/ClientsModal';
import { FraudSignalsModal, type FraudSignal } from '@/components/admin/FraudSignalsModal';
import { MarketingModal } from '@/components/admin/MarketingModal';
import { NotificationsModal } from '@/components/admin/NotificationsModal';
import { ReviewsModal } from '@/components/admin/ReviewsModal';
import { RewardsModal } from '@/components/admin/RewardsModal';
import { ScheduleCalendarModal } from '@/components/admin/ScheduleCalendarModal';
import { ServicesModal } from '@/components/admin/ServicesModal';
import { SettingsModal } from '@/components/admin/SettingsModal';
import { StaffModal } from '@/components/admin/StaffModal';
import { StaffOpsModal } from '@/components/admin/StaffOpsModal';
import { WalkInModal } from '@/components/admin/WalkInModal';
import type { AnalyticsResponse } from '@/types/admin';

type AnalyticsWidgetProps = {
  revenue: number;
  revenueTrend: number;
  staffData: Array<{
    id: number;
    name: string;
    role: string;
    revenue: string;
    avatarColor: string;
  }>;
  utilization: Array<{
    name: string;
    percent: number;
    color: string;
  }>;
  services: Array<{
    label: string;
    percent: number;
    color: string;
  }>;
  timePeriod: TimePeriod;
  onTimePeriodChange: (period: TimePeriod) => void;
  dateRange?: AnalyticsResponse['dateRange'];
  anchorDate: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onAnchorChange: (anchor: string) => void;
};

type AdminModalHostProps = {
  activeModal: AppId | null;
  activeSalonSlug: string | null;
  onCloseModal: () => void;
  showNotifications: boolean;
  setShowNotifications: (value: boolean) => void;
  showFraudSignals: boolean;
  setShowFraudSignals: (value: boolean) => void;
  showScheduleCalendar: boolean;
  setShowScheduleCalendar: (value: boolean) => void;
  showWalkIn: boolean;
  setShowWalkIn: (value: boolean) => void;
  userName: string;
  userInitial: string;
  analyticsProps: AnalyticsWidgetProps;
  fraudSignals: FraudSignal[];
  fraudSignalsTotalCount: number;
  fraudSignalsLoading: boolean;
  fraudSignalsError: string | null;
  fetchFraudSignals: () => void | Promise<void>;
  onFraudSignalResolved: (signalId: string) => void;
};

export function AdminModalHost({
  activeModal,
  activeSalonSlug,
  onCloseModal,
  showNotifications,
  setShowNotifications,
  showFraudSignals,
  setShowFraudSignals,
  showScheduleCalendar,
  setShowScheduleCalendar,
  showWalkIn,
  setShowWalkIn,
  userName,
  userInitial,
  analyticsProps,
  fraudSignals,
  fraudSignalsTotalCount,
  fraudSignalsLoading,
  fraudSignalsError,
  fetchFraudSignals,
  onFraudSignalResolved,
}: AdminModalHostProps) {
  return (
    <>
      <AppModal
        isOpen={activeModal === 'bookings'}
        onClose={onCloseModal}
      >
        <AppointmentsModal onClose={onCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'settings'}
        onClose={onCloseModal}
      >
        <SettingsModal
          onClose={onCloseModal}
          userName={userName}
          userInitials={userInitial}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'analytics'}
        onClose={onCloseModal}
      >
        <AnalyticsWidgets {...analyticsProps} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'clients'}
        onClose={onCloseModal}
      >
        <ClientsModal onClose={onCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'staff'}
        onClose={onCloseModal}
      >
        <StaffModal onClose={onCloseModal} salonSlug={activeSalonSlug} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'services'}
        onClose={onCloseModal}
      >
        <ServicesModal onClose={onCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'marketing'}
        onClose={onCloseModal}
      >
        <MarketingModal onClose={onCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'reviews'}
        onClose={onCloseModal}
      >
        <ReviewsModal onClose={onCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'rewards'}
        onClose={onCloseModal}
      >
        <RewardsModal onClose={onCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'staff-ops'}
        onClose={onCloseModal}
      >
        <StaffOpsModal onClose={onCloseModal} />
      </AppModal>

      <AppModal
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      >
        <NotificationsModal onClose={() => setShowNotifications(false)} />
      </AppModal>

      <AppModal
        isOpen={showFraudSignals}
        onClose={() => setShowFraudSignals(false)}
      >
        <FraudSignalsModal
          signals={fraudSignals}
          totalCount={fraudSignalsTotalCount}
          loading={fraudSignalsLoading}
          error={fraudSignalsError}
          onClose={() => setShowFraudSignals(false)}
          onResolved={onFraudSignalResolved}
          onRefetch={fetchFraudSignals}
        />
      </AppModal>

      <AppModal
        isOpen={showScheduleCalendar}
        onClose={() => setShowScheduleCalendar(false)}
      >
        <ScheduleCalendarModal onClose={() => setShowScheduleCalendar(false)} />
      </AppModal>

      <WalkInModal
        isOpen={showWalkIn}
        onClose={() => setShowWalkIn(false)}
        onSuccess={() => {}}
      />
    </>
  );
}
