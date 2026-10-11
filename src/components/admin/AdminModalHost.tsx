import { lazy, useCallback, useRef } from 'react';

import type { AnalyticsWidgetsProps } from '@/components/admin/AnalyticsWidgets';
import type { AppId } from '@/components/admin/AppGrid';
import { DeferredAppModal as AppModal } from '@/components/admin/DeferredAdminContent';
import { DeferredWalkInModal as WalkInModal } from '@/components/admin/DeferredOwnerDialogs';
import type { FraudSignal } from '@/components/admin/FraudSignalsModal';
import type { IntegrationsView } from '@/components/admin/IntegrationsModal';
import { isOwnerManagementApp } from '@/libs/ownerNavigation';
import { SalonProvider, useSalon } from '@/providers/SalonProvider';
import type { RetentionStage } from '@/types/retention';

const AnalyticsWidgets = lazy(() => import('./AnalyticsWidgets').then(module => ({ default: module.AnalyticsWidgets })));
const AppointmentsModal = lazy(() => import('./AppointmentsModal').then(module => ({ default: module.AppointmentsModal })));
const ClientsModal = lazy(() => import('./ClientsModal').then(module => ({ default: module.ClientsModal })));
const FraudSignalsModal = lazy(() => import('./FraudSignalsModal').then(module => ({ default: module.FraudSignalsModal })));
const IntegrationsModal = lazy(() => import('./IntegrationsModal').then(module => ({ default: module.IntegrationsModal })));
const MarketingModal = lazy(() => import('./MarketingModal').then(module => ({ default: module.MarketingModal })));
const NoShowRecordsModal = lazy(() => import('./NoShowRecordsModal').then(module => ({ default: module.NoShowRecordsModal })));
const NotificationsModal = lazy(() => import('./NotificationsModal').then(module => ({ default: module.NotificationsModal })));
const OwnerManagementModal = lazy(() => import('./OwnerManagementModal').then(module => ({ default: module.OwnerManagementModal })));
const PaymentsModal = lazy(() => import('./PaymentsModal').then(module => ({ default: module.PaymentsModal })));
const PortfolioModal = lazy(() => import('./PortfolioModal').then(module => ({ default: module.PortfolioModal })));
const RewardsReviewsModal = lazy(() => import('./RewardsReviewsModal').then(module => ({ default: module.RewardsReviewsModal })));
const ScheduleCalendarModal = lazy(() => import('./ScheduleCalendarModal').then(module => ({ default: module.ScheduleCalendarModal })));
const ServicesModal = lazy(() => import('./ServicesModal').then(module => ({ default: module.ServicesModal })));
const SettingsModal = lazy(() => import('./SettingsModal').then(module => ({ default: module.SettingsModal })));
const TeamModal = lazy(() => import('./TeamModal').then(module => ({ default: module.TeamModal })));

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
  creditShortcutReturnFocusKey?: string | null;
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
  onNavigate?: (app: string, view?: string, technicianId?: string, replace?: boolean) => void;
  onNavigateBack?: () => void;
  integrationsNotice?: string | null;
  onOpenAppointmentMessagesFromIntegrations?: () => void;
  onOpenOwnerAlertsFromIntegrations?: () => void;
  onManageReminders?: () => void;
  onOpenSocialPosting?: () => void;
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
  teamAppAvailable?: boolean;
  rewardsAvailable?: boolean;
  reviewsAvailable?: boolean;
  analyticsProps: AnalyticsWidgetProps;
  analyticsLoading?: boolean;
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
  creditShortcutReturnFocusKey,
  initialAppointmentId,
  initialClientId,
  initialPromotionStage,
  onOpenPromotionSettings,
  onClosePromotionSettings,
  integrationsInitialView,
  settingsInitialView,
  onNavigate,
  onNavigateBack,
  integrationsNotice,
  onOpenAppointmentMessagesFromIntegrations,
  onOpenOwnerAlertsFromIntegrations,
  onManageReminders,
  onOpenSocialPosting,
  showNotifications,
  setShowNotifications,
  showFraudSignals,
  setShowFraudSignals,
  showScheduleCalendar,
  showWalkIn,
  setShowWalkIn,
  userName,
  userInitial,
  analyticsAppAvailable = false,
  teamAppAvailable = false,
  rewardsAvailable = false,
  reviewsAvailable = false,
  analyticsProps,
  analyticsLoading = false,
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
  const managementClose = useRef<(() => void) | null>(null);
  const registerManagementClose = useCallback((handler: (() => void) | null) => {
    managementClose.current = handler;
  }, []);
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
      {isOwnerManagementApp(activeModal) && (
        <AppModal key={`${activeSalonId}:${activeModal}`} label={{ 'hours': 'Hours & availability', 'booking-rules': 'Booking rules', 'plan-usage': 'Plan & usage', 'help': 'Help' }[activeModal]} isOpen onClose={() => (managementClose.current ?? onCloseModal)()} allowDragToDismiss={false} returnFocusKey={activeModal === 'plan-usage' ? creditShortcutReturnFocusKey : null}>
          <OwnerManagementModal key={`${activeSalonId}:${activeModal}`} registerClose={registerManagementClose} app={activeModal} salonSlug={activeSalonSlug} salonId={activeSalonId} isFreeSolo={isFreeSolo} teamAvailable={teamAppAvailable} onClose={onCloseModal} onOpenApp={onOpenApp} />
        </AppModal>
      )}
      <AppModal
        label="Appointments"
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
        label="Settings"
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
        label="Reports"
        loading={analyticsLoading}
        isOpen={activeModal === 'analytics'}
        onClose={onCloseModal}
      >
        <AnalyticsWidgets
          {...analyticsProps}
          salonSlug={activeSalonSlug}
          onOpenSmartFitSettings={onNavigate ? () => onNavigate('marketing', 'smart-fit') : undefined}
        />
      </AppModal>

      <AppModal
        label="Clients"
        isOpen={activeModal === 'clients'}
        onClose={onCloseModal}
      >
        <ClientsModal
          onClose={onCloseModal}
          initialClientId={initialClientId}
          initialView={settingsInitialView === 'insights' ? 'insights' : 'directory'}
          onOpenPromotionSettings={onOpenPromotionSettings}
        />
      </AppModal>

      <AppModal
        label="Team"
        isOpen={activeModal === 'team' || activeModal === 'staff' || activeModal === 'staff-ops'}
        onClose={onCloseModal}
      >
        <TeamModal
          onClose={onCloseModal}
          salonSlug={activeSalonSlug}
          salonId={activeSalonId}
          isFreeSolo={isFreeSolo}
          initialView={
            activeModal === 'staff-ops'
              ? 'time-off'
              : activeModal === 'staff'
                ? 'members'
                : settingsInitialView === 'permissions'
                  ? 'permissions'
                  : 'home'
          }
        />
      </AppModal>

      <AppModal
        label="Services"
        isOpen={activeModal === 'services'}
        onClose={onCloseModal}
        // The menu is the owner's densest list. It keeps an always-visible
        // Back control in its own header and the sheet keeps its drag handle,
        // so it can spend the backdrop dismiss band on service rows instead.
        topInset="tall"
      >
        <ServicesModal
          onClose={onCloseModal}
          salonSlug={activeSalonSlug}
          onOpenStaff={onOpenApp ? () => onOpenApp('team') : undefined}
        />
      </AppModal>

      <AppModal
        label="Marketing"
        isOpen={activeModal === 'marketing'}
        onClose={onClosePromotionSettings ?? onCloseModal}
      >
        <MarketingModal
          onClose={onClosePromotionSettings ?? onCloseModal}
          initialPromotionStage={initialPromotionStage}
          salonName={activeSalonName ?? undefined}
          onOpenApp={onOpenApp}
          onOpenClient={onOpenMarketingClient}
          onManageReminders={onManageReminders}
          onOpenSocialPosting={onOpenSocialPosting}
          smartFitResultsAvailable={analyticsAppAvailable}
        />
      </AppModal>

      <AppModal
        label="Integrations"
        isOpen={activeModal === 'integrations'}
        onClose={onCloseModal}
        allowDragToDismiss={false}
      >
        <IntegrationsModal
          onClose={onCloseModal}
          salonSlug={activeSalonSlug}
          initialView={integrationsInitialView}
          initialNotice={integrationsNotice}
          onOpenAppointmentMessages={onOpenAppointmentMessagesFromIntegrations}
          onOpenOwnerAlerts={onOpenOwnerAlertsFromIntegrations}
          onOpenPayments={onNavigate ? () => onNavigate('payments', 'stripe') : undefined}
        />
      </AppModal>

      <AppModal
        label="Portfolio"
        isOpen={activeModal === 'portfolio'}
        onClose={onCloseModal}
      >
        <PortfolioModal onClose={onCloseModal} />
      </AppModal>

      <AppModal
        label="Rewards & reviews"
        isOpen={activeModal === 'rewards-reviews' || activeModal === 'rewards' || activeModal === 'reviews'}
        onClose={onCloseModal}
      >
        <RewardsReviewsModal
          onClose={onCloseModal}
          initialView={activeModal === 'reviews' && reviewsAvailable ? 'reviews' : activeModal === 'rewards' && rewardsAvailable ? 'rewards' : 'home'}
          rewardsAvailable={rewardsAvailable}
          reviewsAvailable={reviewsAvailable}
        />
      </AppModal>

      <AppModal
        label="Payments"
        isOpen={activeModal === 'payments'}
        onClose={onCloseModal}
      >
        <PaymentsModal
          onClose={onCloseModal}
          salonSlug={activeSalonSlug}
          salonId={activeSalonId}
          isFreeSolo={isFreeSolo}
        />
      </AppModal>

      <AppModal
        label="No-show records"
        isOpen={activeModal === 'no-show-records'}
        onClose={onCloseModal}
        allowDragToDismiss={false}
      >
        <NoShowRecordsModal key={activeSalonSlug} onClose={onCloseModal} salonSlug={activeSalonSlug} />
      </AppModal>

      <AppModal
        label="Activity"
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      >
        <NotificationsModal onClose={() => setShowNotifications(false)} />
      </AppModal>

      <AppModal
        label="Booking alerts"
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
        label="Calendar"
        isOpen={showScheduleCalendar}
        onClose={onCloseModal}
        allowDragToDismiss={false}
      >
        <ScheduleCalendarModal
          key={activeSalonSlug}
          onClose={onCloseModal}
          salonSlug={activeSalonSlug}
          initialView={settingsInitialView}
          onNavigate={onNavigate}
          onNavigateBack={onNavigateBack}
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
