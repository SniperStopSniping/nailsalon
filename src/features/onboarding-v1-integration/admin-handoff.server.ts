import 'server-only';

import { and, eq } from 'drizzle-orm';

import type {
  HandoffSetupStatus,
  OnboardingSiteHandoff,
} from '@/components/admin/onboarding/OnboardingWorkspaceHandoff';
import { db } from '@/libs/DB';
import { getSalonIntegrationHealth } from '@/libs/integrationHealth';
import {
  onboardingSiteRevisionSchema,
  onboardingSiteSchema,
  serviceSchema,
} from '@/models/Schema';

import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/contracts/service-menu-production-mapping';
import type { OnboardingCompiledSiteDocument } from './contracts';
import { getSavedOnboardingSitePreviewUrl } from './urls';

type HandoffSalon = {
  id: string;
  publicationStatus: string;
  slug: string;
};

const integrationStatus = (
  ready: boolean,
  notStarted: boolean,
): HandoffSetupStatus => ready
  ? 'complete'
  : notStarted
    ? 'not_started'
    : 'needs_attention';

export function hasVisibleBookingSection(
  document: OnboardingCompiledSiteDocument,
): boolean {
  return document.pages.some(page => (
    page.visible
    && page.sections.some(section => section.visible && section.type === 'booking')
  ));
}

export function deriveOnboardingSiteHandoff(input: {
  activeServiceSourceIds: readonly string[];
  canEditSetup: boolean;
  document: OnboardingCompiledSiteDocument;
  googleReadiness: string;
  locale: string;
  paymentsStatus: string;
  salon: HandoffSalon;
  site: {
    dashboardTourCompletedAt: Date | null;
    dashboardWelcomeDismissedAt: Date | null;
    id: string;
    planIntent: 'founding_interest' | 'free' | 'monthly_interest' | null;
    revision: number;
    serviceMenuApplied: boolean;
    status: string;
  };
}): OnboardingSiteHandoff {
  const selectedServiceIds = input.document.serviceSelection.selectedServiceIds;
  const activeServiceSourceIds = new Set(input.activeServiceSourceIds);
  for (const mapping of [
    ...SERVICE_MENU_PRODUCTION_MAPPINGS,
    ...ADD_ON_PRODUCTION_MAPPINGS,
  ]) {
    if (activeServiceSourceIds.has(mapping.productionCanonicalId)) {
      activeServiceSourceIds.add(mapping.labServiceId);
    }
  }
  const googleCalendar = integrationStatus(
    input.googleReadiness === 'ready',
    input.googleReadiness === 'not_connected',
  );
  const payments = integrationStatus(
    input.paymentsStatus === 'charge_ready',
    input.paymentsStatus === 'not_connected',
  );
  const shareLink: HandoffSetupStatus = input.salon.publicationStatus === 'published'
    ? 'complete'
    : input.salon.publicationStatus === 'draft'
      ? 'not_started'
      : 'needs_attention';
  const locale = input.locale === 'fr' ? 'fr' : 'en';

  return {
    handoff: {
      planIntent: input.site.planIntent,
      showWelcome: input.site.dashboardWelcomeDismissedAt === null,
      tourCompleted: input.site.dashboardTourCompletedAt !== null,
    },
    setup: {
      googleCalendar,
      payments,
      servicesAdded: input.site.serviceMenuApplied
        && selectedServiceIds.length > 0
        && selectedServiceIds.every(serviceId => activeServiceSourceIds.has(serviceId)),
      shareLink,
    },
    site: {
      hasVisibleBookingSection: hasVisibleBookingSection(input.document),
      id: input.site.id,
      previewUrl: getSavedOnboardingSitePreviewUrl({
        locale,
        siteId: input.site.id,
      }),
      revision: input.site.revision,
      setupAvailable: input.canEditSetup
        && input.salon.publicationStatus === 'draft'
        && input.site.status === 'draft',
      setupUrl: `/${locale}/onboarding-v1?resume=review&site=${encodeURIComponent(input.site.id)}&revision=${input.site.revision}`,
    },
  };
}

export async function getOnboardingSiteHandoff(input: {
  canEditSetup: boolean;
  locale: string;
  salon: HandoffSalon;
}): Promise<OnboardingSiteHandoff | null> {
  const [siteRows, services, health] = await Promise.all([
    db
      .select({
        dashboardTourCompletedAt: onboardingSiteSchema.dashboardTourCompletedAt,
        dashboardWelcomeDismissedAt: onboardingSiteSchema.dashboardWelcomeDismissedAt,
        document: onboardingSiteRevisionSchema.document,
        id: onboardingSiteSchema.id,
        planIntent: onboardingSiteSchema.planIntent,
        revision: onboardingSiteRevisionSchema.revision,
        serviceMenuApplied: onboardingSiteSchema.serviceMenuApplied,
        status: onboardingSiteSchema.status,
      })
      .from(onboardingSiteSchema)
      .innerJoin(
        onboardingSiteRevisionSchema,
        and(
          eq(onboardingSiteRevisionSchema.salonId, onboardingSiteSchema.salonId),
          eq(onboardingSiteRevisionSchema.siteId, onboardingSiteSchema.id),
          eq(onboardingSiteRevisionSchema.revision, onboardingSiteSchema.currentRevision),
        ),
      )
      .where(and(
        eq(onboardingSiteSchema.salonId, input.salon.id),
        eq(onboardingSiteSchema.isCurrent, true),
      ))
      .limit(1),
    db
      .select({
        onboardingSourceServiceId: serviceSchema.onboardingSourceServiceId,
        templateKey: serviceSchema.templateKey,
      })
      .from(serviceSchema)
      .where(and(
        eq(serviceSchema.salonId, input.salon.id),
        eq(serviceSchema.isActive, true),
      )),
    getSalonIntegrationHealth(input.salon.id),
  ]);
  const site = siteRows[0];
  if (!site) {
    return null;
  }

  return deriveOnboardingSiteHandoff({
    activeServiceSourceIds: [...new Set(services.flatMap(item => [
      item.onboardingSourceServiceId,
      item.templateKey,
    ].filter((value): value is string => Boolean(value))))],
    canEditSetup: input.canEditSetup,
    document: site.document,
    googleReadiness: health.google.readiness,
    locale: input.locale,
    paymentsStatus: health.stripeConnect.status,
    salon: input.salon,
    site,
  });
}

export async function updateOnboardingSiteHandoff(input: {
  action: 'complete_tour' | 'dismiss_welcome';
  salonId: string;
  siteId?: string;
}): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(onboardingSiteSchema)
    .set(input.action === 'dismiss_welcome'
      ? { dashboardWelcomeDismissedAt: now }
      : { dashboardTourCompletedAt: now })
    .where(and(
      eq(onboardingSiteSchema.salonId, input.salonId),
      eq(onboardingSiteSchema.isCurrent, true),
      ...(input.siteId ? [eq(onboardingSiteSchema.id, input.siteId)] : []),
    ))
    .returning();
  return rows.length === 1;
}
