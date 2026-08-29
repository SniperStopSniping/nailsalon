import { goToScreen } from '../../model/routing';
import type {
  DashboardChecklistItem,
  DashboardHandoffPort,
  DashboardTourPort,
  SetupChecklistInput,
  SetupChecklistPort,
} from '../contracts/dashboard';

const hasBookingSection = (input: SetupChecklistInput): boolean => Boolean(
  input.document?.pages.some((page) => page.sections.some(
    (section) => section.sectionType === 'booking',
  )),
);

const DASHBOARD_TOUR_STEPS = [
  {
    description: 'See upcoming appointments, today’s schedule, revenue, follow-ups and anything that needs attention.',
    destination: 'today',
    id: 'today',
    title: 'Your day at a glance',
  },
  {
    description: 'Review weekly and monthly appointments, Google Busy or Free events, and add an appointment.',
    destination: 'calendar',
    id: 'calendar',
    title: 'Your calendar',
  },
  {
    description: 'Find client visits, spending and follow-ups together.',
    destination: 'clients',
    id: 'clients',
    title: 'Your clients',
  },
  {
    description: 'Update prices, durations, photos and add-ons, or return to the Service Library.',
    destination: 'services',
    id: 'services',
    title: 'Your services',
  },
  {
    description: 'Preview and edit your website, then share the Booking Page link with clients.',
    destination: 'website',
    id: 'website',
    title: 'Your website and booking page',
  },
] as const;

export const LAB_DASHBOARD_HANDOFF_PORT: DashboardHandoffPort = {
  authenticatedProductionPath: '/[locale]/admin',
  getInitialDestination: () => 'today',
  kind: 'ux_lab_storyboard',
  prepareOnboardingReview: (state) => goToScreen(state, 'final_preview'),
};

export const LAB_DASHBOARD_TOUR_PORT: DashboardTourPort = {
  getSteps: () => DASHBOARD_TOUR_STEPS,
};

export const LAB_SETUP_CHECKLIST_PORT: SetupChecklistPort = {
  getItems: (input) => {
    const items: DashboardChecklistItem[] = [
      {
        destination: 'website',
        id: 'website_created',
        label: 'Website created',
        source: 'lab_document',
        status: input.document ? 'complete' : 'needs_attention',
      },
      {
        destination: 'website',
        id: 'booking_ready',
        label: 'Booking page ready',
        source: 'lab_document',
        status: hasBookingSection(input) ? 'complete' : 'needs_attention',
      },
      {
        destination: 'services',
        id: 'services_added',
        label: 'Services added',
        source: 'lab_service_ids',
        status: input.selectedServiceIds.length > 0 ? 'complete' : 'needs_attention',
      },
      {
        destination: 'calendar',
        id: 'google_calendar',
        label: 'Connect Google Calendar',
        source: 'lab_integration_fixture',
        status: input.fixtures.googleCalendar,
      },
      {
        destination: 'more',
        id: 'payments',
        label: 'Set up payments',
        source: 'lab_integration_fixture',
        status: input.fixtures.payments,
      },
      {
        destination: 'website',
        id: 'share_booking_link',
        label: 'Share booking link',
        source: 'lab_integration_fixture',
        status: input.fixtures.shareBookingLink,
      },
    ];
    return items;
  },
};
