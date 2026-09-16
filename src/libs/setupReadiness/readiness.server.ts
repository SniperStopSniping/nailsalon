import 'server-only';

import { and, eq, gte, inArray } from 'drizzle-orm';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { resolveBookingHoursCeiling } from '@/libs/bookingHoursCeiling';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { db } from '@/libs/DB';
import { getDepositPolicyForSalon } from '@/libs/depositPolicy.server';
import { resolveEntitlement } from '@/libs/featureEntitlements';
import { getSalonIntegrationHealth } from '@/libs/integrationHealth';
import {
  getPrimaryLocation,
  getSalonById,
  getServicesBySalonIdIncludingInactive,
  getTechniciansBySalonId,
} from '@/libs/queries';
import { getPublicBookableServiceIds } from '@/libs/serviceAssignments';
import { getDateKeyInTimeZone } from '@/libs/timeZone';
import { technicianScheduleOverrideSchema } from '@/models/Schema';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

import { deriveSetupReadiness } from './readiness';
import type { SetupReadinessInput, SetupReadinessResult } from './types';

/**
 * A1-3 Piece 1 — the loader.
 *
 * Its ONLY job is to fetch what `deriveSetupReadiness` needs and hand it over.
 * There is no derivation here: every rule lives in the pure module so it stays
 * testable without a database, and every value below comes from an authority
 * that already exists rather than from a query written for this projection.
 *
 * The single exception is the schedule-override read at the bottom. It is a
 * new query because the existing one (`loadBookingPolicy`, `bookingPolicy.ts`)
 * is scoped to ONE date by design — this projection asks a different question
 * ("does this technician have any upcoming hours override at all?") and must
 * not widen a booking-path loader to answer it.
 *
 * NO CLIENT DATA IS READ. Appointments, clients, notes and money totals are
 * never queried here, so they cannot reach the projection even by accident.
 */

/** Only an `hours` override can stand in for a missing weekly schedule; `off` cannot. */
const HOURS_OVERRIDE_TYPE = 'hours';

/**
 * Builds the readiness projection for one salon.
 *
 * @returns the projection, or `null` when the salon does not exist (or is not
 * active — `getSalonById` filters deleted/inactive rows, and there is no
 * readiness answer for a salon the owner cannot reach).
 */
export async function loadSetupReadiness(
  salonId: string,
  now: Date = new Date(),
): Promise<SetupReadinessResult | null> {
  const salon = await getSalonById(salonId);
  if (!salon) {
    return null;
  }

  const settings = (salon.settings as SalonSettings | null | undefined) ?? null;
  const features = (salon.features as SalonFeatures | null | undefined) ?? null;
  const bookingConfig = resolveBookingConfigFromSettings(settings);

  const [
    services,
    technicians,
    publiclyBookableServiceIds,
    primaryLocation,
    depositPolicy,
    integrationHealth,
  ] = await Promise.all([
    getServicesBySalonIdIncludingInactive(salonId),
    getTechniciansBySalonId(salonId),
    getPublicBookableServiceIds(salonId),
    getPrimaryLocation(salonId),
    // Stored rows only — `getDepositPolicyForSalon` makes no provider call on
    // any path, which is why it is safe on a page-load-frequency projection.
    getDepositPolicyForSalon({ salonId, salon }),
    getSalonIntegrationHealth(salonId),
  ]);

  const technicianIdsWithUpcomingHoursOverrides = await loadUpcomingHoursOverrideTechnicianIds({
    salonId,
    technicianIds: technicians.map(technician => technician.id),
    todayKey: getDateKeyInTimeZone(now, bookingConfig.timezone),
  });

  const input: SetupReadinessInput = {
    salon: {
      name: salon.name,
      publicationStatus: salon.publicationStatus,
    },
    bookingConfig,
    bookingPageConfig: resolveBookingPageConfig(settings),
    bookingPageContent: resolveBookingPageContent(settings),
    services: services.map(service => ({
      id: service.id,
      name: service.name,
      isActive: service.isActive,
      templateKey: service.templateKey,
      price: service.price,
    })),
    technicians: technicians.map(technician => ({
      id: technician.id,
      // Already resolved by `getTechniciansBySalonId` via the same
      // `resolveWeeklySchedule`; the pure module re-resolves idempotently.
      weeklySchedule: technician.weeklySchedule,
      workDays: technician.workDays,
      startTime: technician.startTime,
      endTime: technician.endTime,
    })),
    publiclyBookableServiceIds,
    hoursCeiling: resolveBookingHoursCeiling({
      location: primaryLocation
        ? { id: primaryLocation.id, businessHours: primaryLocation.businessHours ?? null }
        : null,
      salonBusinessHours: salon.businessHours ?? null,
    }),
    depositPolicy: {
      active: depositPolicy.active,
      reason: depositPolicy.active ? null : depositPolicy.reason,
      readinessStale: depositPolicy.readinessStale,
    },
    scheduleOverridesEntitled: resolveEntitlement(features, 'staff', 'scheduleOverrides'),
    technicianIdsWithUpcomingHoursOverrides,
    integrations: {
      googleReadiness: integrationHealth.google.readiness,
      stripeConnectStatus: integrationHealth.stripeConnect.status,
    },
    now,
  };

  return deriveSetupReadiness(input);
}

/**
 * Technicians holding at least one `hours` override dated today or later, in
 * the salon's own time zone. Salon-scoped AND technician-scoped so a stale id
 * can never pull a row from another tenant.
 */
async function loadUpcomingHoursOverrideTechnicianIds(args: {
  salonId: string;
  technicianIds: string[];
  todayKey: string;
}): Promise<ReadonlySet<string>> {
  if (args.technicianIds.length === 0) {
    return new Set<string>();
  }

  const rows = await db
    .select({ technicianId: technicianScheduleOverrideSchema.technicianId })
    .from(technicianScheduleOverrideSchema)
    .where(
      and(
        eq(technicianScheduleOverrideSchema.salonId, args.salonId),
        inArray(technicianScheduleOverrideSchema.technicianId, args.technicianIds),
        eq(technicianScheduleOverrideSchema.type, HOURS_OVERRIDE_TYPE),
        // `date` is a `YYYY-MM-DD` text column, so lexicographic ordering is
        // chronological ordering.
        gte(technicianScheduleOverrideSchema.date, args.todayKey),
      ),
    );

  return new Set(rows.map(row => row.technicianId));
}
