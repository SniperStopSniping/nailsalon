import {
  AnalyticsWidgets,
  type AnalyticsWidgetsProps,
} from '@/components/admin/AnalyticsWidgets';
import type { AppId } from '@/components/admin/AppGrid';
import { AppModal } from '@/components/admin/AppModal';
import { AppointmentsModal } from '@/components/admin/AppointmentsModal';
import { ClientsModal } from '@/components/admin/ClientsModal';
import { type FraudSignal, FraudSignalsModal } from '@/components/admin/FraudSignalsModal';
import { IntegrationsModal, type IntegrationsView } from '@/components/admin/IntegrationsModal';
import { MarketingModal } from '@/components/admin/MarketingModal';
import { NotificationsModal } from '@/components/admin/NotificationsModal';
import { PortfolioModal } from '@/components/admin/PortfolioModal';
import { ReviewsModal } from '@/components/admin/ReviewsModal';
import { RewardsModal } from '@/components/admin/RewardsModal';
import { ScheduleCalendarModal } from '@/components/admin/ScheduleCalendarModal';
import { ServicesModal } from '@/components/admin/ServicesModal';
import { SettingsModal } from '@/components/admin/SettingsModal';
import { StaffModal } from '@/components/admin/StaffModal';
import { StaffOpsModal } from '@/components/admin/StaffOpsModal';
import { UsageBillingModal } from '@/components/admin/UsageBillingModal';
import { WalkInModal } from '@/components/admin/WalkInModal';
import { SalonProvider, useSalon } from '@/providers/SalonProvider';
import type { RetentionStage } from '@/types/retention';

type PromotionSettingsStage = Extract<
  RetentionStage,
  'promo_6w' | 'promo_8w'
>;

type AnalyticsWidgetProps = Omit<
  AnalyticsWidgetsProps,
  'salonSlug' | 'onOpenSmartFitSettings'
>;

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
  settingsInitialView?: string;
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
  settingsInitialView,
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
  // OP-011 root cause: the root layout's SalonProvider is filled from the
  // `__active_salon_slug` cookie, which the owner workspace does not set, so
  // every modal that read `useSalon()` saw the EMPTY salon and never loaded.
  // Re-provide the context here from the workspace's own active salon (the
  // one the URL / auth payload resolved) so all `?app=` modals share the
  // dashboard's authority. Everything the dashboard does not know is
  // inherited from the outer context unchanged.
  const outerSalon = useSalon();
  const salonSlugForModals = activeSalonSlug || outerSalon.salonSlug || undefined;
  const salonIdForModals = (activeSalonSlug && activeSalonId) || outerSalon.salonId || undefined;
  const salonNameForModals = (activeSalonSlug && activeSalonName) || outerSalon.salonName || undefined;

  return (
    <SalonProvider
      salonId={salonIdForModals}
      salonName={salonNameForModals}
      salonSlug={salonSlugForModals}
      themeKey={outerSalon.themeKey}
      status={outerSalon.status}
      bookingExperience={outerSalon.bookingExperience}
      bookingTimeZone={outerSalon.bookingTimeZone}
      bookingPage={outerSalon.bookingPage}
      ownerPreview={outerSalon.ownerPreview}
      salonContent={outerSalon.salonContent}
    >
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
          initialView={settingsInitialView}
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

      {activeModal === 'client-reminders' && salonSlugForModals && (
        <UsageBillingModal
          salonSlug={salonSlugForModals}
          onClose={onCloseModal}
        />
      )}

      <AppModal
        isOpen={activeModal === 'reviews'}
        onClose={onCloseModal}
      >
        <ReviewsModal onClose={onCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'portfolio'}
        onClose={onCloseModal}
      >
        <PortfolioModal onClose={onCloseModal} />
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
        <StaffOpsModal onClose={onCloseModal} salonSlug={activeSalonSlug} />
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
        <ScheduleCalendarModal
          onClose={() => setShowScheduleCalendar(false)}
          salonSlug={activeSalonSlug}
        />
      </AppModal>

      <WalkInModal
        isOpen={showWalkIn}
        onClose={() => setShowWalkIn(false)}
        onSuccess={() => {}}
        salonSlug={activeSalonSlug}
      />
    </SalonProvider>
  );
}
