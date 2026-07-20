import { AnalyticsWidgets, type TimePeriod } from '@/components/admin/AnalyticsWidgets';
import type { AppId } from '@/components/admin/AppGrid';
import { AppModal } from '@/components/admin/AppModal';
import { AppointmentsModal } from '@/components/admin/AppointmentsModal';
import { ClientsModal } from '@/components/admin/ClientsModal';
import { type FraudSignal, FraudSignalsModal } from '@/components/admin/FraudSignalsModal';
import { IntegrationsModal, type IntegrationsView } from '@/components/admin/IntegrationsModal';
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
import type { RetentionStage } from '@/types/retention';

type PromotionSettingsStage = Extract<
  RetentionStage,
  'promo_6w' | 'promo_8w'
>;

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
  activeSalonId?: string | null;
  onOpenApp?: (appId: string) => void;
  activeSalonName?: string | null;
  /** Open a client profile from the Marketing follow-ups list. */
  onOpenMarketingClient?: (clientId: string) => void;
  isFreeSolo: boolean;
  onCloseModal: () => void;
  initialAppointmentId?: string | null;
  initialClientId?: string | null;
  initialPromotionStage?: PromotionSettingsStage | null;
  onOpenPromotionSettings?: (
    stage: PromotionSettingsStage,
    clientId: string,
  ) => void;
  onClosePromotionSettings?: () => void;
  integrationsInitialView?: IntegrationsView;
  integrationsNotice?: string | null;
  onOpenSettingsFromIntegrations?: () => void;
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
  /** Whether the Analytics app is available to this salon (module-gated). */
  analyticsAppAvailable?: boolean;
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
  activeSalonId = null,
  onOpenApp,
  activeSalonName = null,
  onOpenMarketingClient,
  isFreeSolo,
  onCloseModal,
  initialAppointmentId,
  initialClientId,
  initialPromotionStage,
  onOpenPromotionSettings,
  onClosePromotionSettings,
  integrationsInitialView,
  integrationsNotice,
  onOpenSettingsFromIntegrations,
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
  analyticsAppAvailable = false,
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
        allowDragToDismiss={false}
      >
        <AppointmentsModal
          onClose={onCloseModal}
          initialAppointmentId={initialAppointmentId}
          salonSlug={activeSalonSlug}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'settings'}
        onClose={onCloseModal}
      >
        <SettingsModal
          onClose={onCloseModal}
          salonSlug={activeSalonSlug}
          salonId={activeSalonId}
          userName={userName}
          userInitials={userInitial}
          isFreeSolo={isFreeSolo}
          onOpenApp={onOpenApp}
          smartFitResultsAvailable={analyticsAppAvailable}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'analytics'}
        onClose={onCloseModal}
      >
        <AnalyticsWidgets
          {...analyticsProps}
          salonSlug={activeSalonSlug}
          onOpenSmartFitSettings={onOpenApp ? () => onOpenApp('settings') : undefined}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'clients'}
        onClose={onCloseModal}
      >
        <ClientsModal
          onClose={onCloseModal}
          initialClientId={initialClientId}
          onOpenPromotionSettings={onOpenPromotionSettings}
        />
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
        <ServicesModal
          onClose={onCloseModal}
          salonSlug={activeSalonSlug}
          onOpenStaff={onOpenApp ? () => onOpenApp('staff') : undefined}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'marketing'}
        onClose={onClosePromotionSettings ?? onCloseModal}
      >
        <MarketingModal
          onClose={onClosePromotionSettings ?? onCloseModal}
          initialPromotionStage={initialPromotionStage}
          salonName={activeSalonName ?? undefined}
          onOpenApp={onOpenApp}
          onOpenClient={onOpenMarketingClient}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'integrations'}
        onClose={onCloseModal}
        allowDragToDismiss={false}
      >
        <IntegrationsModal
          onClose={onCloseModal}
          salonSlug={activeSalonSlug}
          initialView={integrationsInitialView}
          initialNotice={integrationsNotice}
          onOpenSettings={onOpenSettingsFromIntegrations}
        />
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
