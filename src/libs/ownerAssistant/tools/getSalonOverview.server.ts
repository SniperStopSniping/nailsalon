import 'server-only';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { resolveBookingHoursCeiling } from '@/libs/bookingHoursCeiling';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import type { BusinessHours } from '@/libs/bookingPolicy';
import { getSalonIntegrationHealth } from '@/libs/integrationHealth';
import { getPrimaryLocation, getSalonById, getTechniciansBySalonId } from '@/libs/queries';
import { getDateKeyInTimeZone } from '@/libs/timeZone';
import type { SalonSettings } from '@/types/salonPolicy';

import type { SalonOverviewResult, Weekday } from '../contracts';

/**
 * `get_salon_overview` (docs/OWNER_ASSISTANT_CHAT.md §3.3).
 *
 * Tier-0 projection of the salon's own setup, assembled from the SAME helpers
 * the owner dashboard and the public booking page read, so the assistant can
 * never describe a state the product does not actually have. Nothing here
 * touches clients, appointments or money.
 */

const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

function summarizeHours(businessHours: BusinessHours): {
  openDays: Weekday[];
  byDay: Partial<Record<Weekday, string>>;
} {
  const openDays: Weekday[] = [];
  const byDay: Partial<Record<Weekday, string>> = {};

  for (const day of WEEKDAYS) {
    const window = businessHours?.[day];
    if (!window?.open || !window?.close) {
      continue;
    }
    openDays.push(day);
    byDay[day] = `${window.open}–${window.close}`;
  }

  return { openDays, byDay };
}

export class OwnerAssistantSalonMissingError extends Error {
  constructor() {
    super('SALON_NOT_FOUND');
    this.name = 'OwnerAssistantSalonMissingError';
  }
}

export async function getSalonOverview(
  salonId: string,
  options: { now?: Date } = {},
): Promise<SalonOverviewResult> {
  const salon = await getSalonById(salonId);
  if (!salon) {
    throw new OwnerAssistantSalonMissingError();
  }

  const settings = (salon.settings as SalonSettings | null | undefined) ?? null;
  const bookingConfig = resolveBookingConfigFromSettings(settings);

  const [technicians, location, health] = await Promise.all([
    getTechniciansBySalonId(salonId),
    getPrimaryLocation(salonId),
    getSalonIntegrationHealth(salonId),
  ]);

  const ceiling = resolveBookingHoursCeiling({
    location: location ? { id: location.id, businessHours: location.businessHours ?? undefined } : null,
    salonBusinessHours: salon.businessHours ?? undefined,
  });
  const hours = summarizeHours(ceiling.businessHours);

  const content = resolveBookingPageContent(salon.settings);
  // `businessMode` is a booking-page setting, not a salon column — there is no
  // `salon.business_mode` in Schema.ts (verified on this base).
  const pageConfig = resolveBookingPageConfig(salon.settings);

  return {
    salonName: salon.name,
    salonSlug: salon.slug,
    publicationStatus: salon.publicationStatus,
    timezone: bookingConfig.timezone,
    today: getDateKeyInTimeZone(options.now ?? new Date(), bookingConfig.timezone),
    currency: bookingConfig.currency,
    businessMode: pageConfig.draft.businessMode ?? null,
    technicianCount: technicians.length,
    technicianNames: technicians.map(technician => technician.name),
    hours: {
      source: ceiling.source,
      openDays: hours.openDays,
      byDay: hours.byDay,
    },
    bookingRules: {
      minimumNoticeMinutes: bookingConfig.minimumNoticeMinutes,
      slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
      bufferMinutes: bookingConfig.bufferMinutes,
    },
    integrations: {
      googleCalendar: health.google.readiness,
      // "Connected" here means Stripe can actually take a charge for this
      // salon, which is what an owner means by "are payments set up".
      paymentsConnected: health.stripeConnect.chargeReady,
    },
    bookingPage: {
      logoSaved: Boolean(salon.logoUrl),
      profilePhotoSaved: technicians.some(technician => Boolean(technician.avatarUrl)),
      hasBio: Boolean(content.draft.bio),
      heroImageSaved: Boolean(content.draft.heroImageUrl),
    },
  };
}
