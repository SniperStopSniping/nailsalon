import type { SiteBuilderDocument } from '../../../model/types';
import type { OnboardingLabState } from '../../model/types';

export type DashboardDestination =
  | 'today'
  | 'calendar'
  | 'clients'
  | 'services'
  | 'website'
  | 'more';

export type DashboardIntegrationStatus = 'connected' | 'needs_attention' | 'not_connected';

export type DashboardChecklistItemId =
  | 'website_created'
  | 'booking_ready'
  | 'services_added'
  | 'google_calendar'
  | 'payments'
  | 'share_booking_link';

export type DashboardChecklistItem = {
  destination: DashboardDestination;
  id: DashboardChecklistItemId;
  label: string;
  source: 'lab_document' | 'lab_integration_fixture' | 'lab_service_ids';
  status: 'complete' | DashboardIntegrationStatus;
};

export type DashboardChecklistFixtures = {
  googleCalendar: DashboardIntegrationStatus;
  payments: DashboardIntegrationStatus;
  shareBookingLink: DashboardIntegrationStatus;
};

export type SetupChecklistInput = {
  document: SiteBuilderDocument | null;
  fixtures: DashboardChecklistFixtures;
  selectedServiceIds: readonly string[];
};

export type SetupChecklistPort = {
  getItems: (input: SetupChecklistInput) => readonly DashboardChecklistItem[];
};

export type DashboardHandoffPort = {
  authenticatedProductionPath: '/[locale]/admin';
  getInitialDestination: () => DashboardDestination;
  kind: 'ux_lab_storyboard';
  prepareOnboardingReview: (state: OnboardingLabState) => OnboardingLabState;
};

export type DashboardTourStep = {
  description: string;
  destination: DashboardDestination;
  id: DashboardDestination;
  title: string;
};

export type DashboardTourPort = {
  getSteps: () => readonly DashboardTourStep[];
};
