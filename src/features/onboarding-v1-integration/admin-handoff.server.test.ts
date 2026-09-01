import { describe, expect, it, vi } from 'vitest';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import {
  deriveOnboardingSiteHandoff,
  hasVisibleBookingSection,
} from './admin-handoff.server';
import type { OnboardingCompiledSiteDocument } from './contracts';

vi.mock('server-only', () => ({}));

const document = (bookingVisible = true): OnboardingCompiledSiteDocument => ({
  builderDocument: initializeStarter('one_page', {
    siteId: 'site_1',
    siteName: 'Isla Nail Studio',
  }),
  compilerVersion: 1,
  navigation: [{ label: 'Home', order: 0, pageId: 'site:page:home' }],
  navigationEnabled: true,
  pages: [{
    id: 'site:page:home',
    isHome: true,
    label: 'Home',
    order: 0,
    sections: [{
      id: 'site:home:booking',
      order: 0,
      presentation: {},
      source: 'service_menu',
      type: 'booking',
      visible: bookingVisible,
    }],
    slug: '',
    visible: true,
    visibleInNavigation: true,
  }],
  palettePresetId: 'luster_berry',
  recipeMigrationResult: 'fresh_v1',
  recipeVersion: 1,
  revision: 3,
  schemaVersion: 1,
  serviceSelection: { selectedAddOnIds: [], selectedServiceIds: ['service_1'] },
  siteId: 'site_1',
  siteName: 'Isla Nail Studio',
  sourceSnapshotVersion: 1,
  starter: 'one_page',
  stylePresetId: 'modern',
});

describe('admin onboarding-site handoff', () => {
  it('derives every checklist item from canonical persisted/integration status', () => {
    const handoff = deriveOnboardingSiteHandoff({
      activeServiceSourceIds: ['service_1'],
      document: document(),
      googleReadiness: 'ready',
      locale: 'en',
      paymentsStatus: 'action_needed_soon',
      salon: { id: 'salon_1', publicationStatus: 'draft', slug: 'isla' },
      site: {
        dashboardTourCompletedAt: null,
        dashboardWelcomeDismissedAt: null,
        id: '2d799a1b-2eab-4de5-b005-a1e688658bad',
        planIntent: 'founding_interest',
        revision: 3,
        serviceMenuApplied: true,
      },
    });

    expect(handoff.site.hasVisibleBookingSection).toBe(true);
    expect(handoff.setup).toEqual({
      googleCalendar: 'complete',
      payments: 'needs_attention',
      servicesAdded: true,
      shareLink: 'not_started',
    });
    expect(handoff.handoff).toEqual({
      planIntent: 'founding_interest',
      showWelcome: true,
      tourCompleted: false,
    });
    expect(handoff.site.previewUrl).toBe(
      '/en/admin/website/preview/2d799a1b-2eab-4de5-b005-a1e688658bad',
    );
    expect(handoff.site.setupUrl).toContain('resume=review');
    expect(handoff.site.setupAvailable).toBe(true);
  });

  it('does not claim a hidden Booking section is ready', () => {
    expect(hasVisibleBookingSection(document(false))).toBe(false);
  });

  it('does not offer onboarding replacement over a published business', () => {
    const handoff = deriveOnboardingSiteHandoff({
      activeServiceSourceIds: ['service_1'],
      document: document(),
      googleReadiness: 'ready',
      locale: 'en',
      paymentsStatus: 'charge_ready',
      salon: { id: 'salon_1', publicationStatus: 'published', slug: 'isla' },
      site: {
        dashboardTourCompletedAt: null,
        dashboardWelcomeDismissedAt: null,
        id: '2d799a1b-2eab-4de5-b005-a1e688658bad',
        planIntent: 'free',
        revision: 3,
        serviceMenuApplied: true,
      },
    });

    expect(handoff.site.setupAvailable).toBe(false);
  });

  it('does not count unrelated pre-existing services as onboarding services', () => {
    const handoff = deriveOnboardingSiteHandoff({
      activeServiceSourceIds: ['unrelated-service'],
      document: document(),
      googleReadiness: 'not_connected',
      locale: 'en',
      paymentsStatus: 'not_connected',
      salon: { id: 'salon_1', publicationStatus: 'draft', slug: 'isla' },
      site: {
        dashboardTourCompletedAt: null,
        dashboardWelcomeDismissedAt: null,
        id: '2d799a1b-2eab-4de5-b005-a1e688658bad',
        planIntent: 'free',
        revision: 3,
        serviceMenuApplied: true,
      },
    });

    expect(handoff.setup.servicesAdded).toBe(false);
  });

  it('recognizes an active Production template key as its selected Lab service ID', () => {
    const mapped = document();
    mapped.serviceSelection.selectedServiceIds = ['svc-manicure-gel'];
    const handoff = deriveOnboardingSiteHandoff({
      activeServiceSourceIds: ['gel_manicure'],
      document: mapped,
      googleReadiness: 'not_connected',
      locale: 'en',
      paymentsStatus: 'not_connected',
      salon: { id: 'salon_1', publicationStatus: 'draft', slug: 'isla' },
      site: {
        dashboardTourCompletedAt: null,
        dashboardWelcomeDismissedAt: null,
        id: '2d799a1b-2eab-4de5-b005-a1e688658bad',
        planIntent: 'free',
        revision: 3,
        serviceMenuApplied: true,
      },
    });

    expect(handoff.setup.servicesAdded).toBe(true);
  });

  it('does not claim services were applied when an existing-site conflict preserved Product data', () => {
    const handoff = deriveOnboardingSiteHandoff({
      activeServiceSourceIds: ['service_1'],
      document: document(),
      googleReadiness: 'not_connected',
      locale: 'en',
      paymentsStatus: 'not_connected',
      salon: { id: 'salon_1', publicationStatus: 'draft', slug: 'isla' },
      site: {
        dashboardTourCompletedAt: null,
        dashboardWelcomeDismissedAt: null,
        id: '2d799a1b-2eab-4de5-b005-a1e688658bad',
        planIntent: 'free',
        revision: 3,
        serviceMenuApplied: false,
      },
    });

    expect(handoff.setup.servicesAdded).toBe(false);
  });
});
