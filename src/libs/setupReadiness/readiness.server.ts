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
import { resolveWeeklySchedule } from '@/libs/weeklySchedule';
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
 * The single exception is the schedule-override read below. It is a new query
 * because the existing one (`loadBookingPolicy`, `bookingPolicy.ts`) is scoped
 * to ONE date by design — this projection asks a different question ("does
 * this technician have any upcoming hours override at all?") and must not
 * widen a booking-path loader to answer it. It is also the only read that is
 * conditional: it is skipped outright when the salon is not entitled to
 * schedule overrides or when no technician is missing a weekly schedule,
 * because in both cases the derivation would discard every row it returned.
 *
 * NO CLIENT DATA REACHES THE PROJECTION. Nothing here queries appointments,
 * clients, notes or money totals directly. The one loader that reaches wider
 * is `getSalonIntegrationHealth`, which is a pre-existing authority with its
 * own job: it also reads the salon's latest failed SMS `notification_delivery`
 * row and runs a credit-ledger balance transaction. None of that is queried
 * for this projection and none of it is carried by it — exactly two connection
 * scalars are read out of its result (`google.readiness` and
 * `stripeConnect.status`) and everything else is dropped on the floor. The
 * `SetupReadinessInput` type has no field that could carry the rest, and
 * `readiness.privacy.test.ts` holds the result to a client-data denylist.
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

  // Resolved BEFORE the fan-out because it decides whether the override query
  // runs at all: an override on an unentitled salon is inert, so the
  // derivation would discard the rows anyway (see `technician_no_weekly_days`
  // in `readiness.ts`). Reading a plain JSONB field off the salon row costs
  // nothing; the query it can skip is a real round trip.
  const scheduleOverridesEntitled = resolveEntitlement(features, 'staff', 'scheduleOverrides');
  const todayKey = getDateKeyInTimeZone(now, bookingConfig.timezone);

  // Hoisted out of the array so the override read can chain off it: it starts
  // the moment the technicians land instead of waiting for the whole fan-out,
  // while still resolving as one member of the same `Promise.all`.
  const techniciansPromise = getTechniciansBySalonId(salonId);

  const [
    services,
    technicians,
    publiclyBookableServiceIds,
    primaryLocation,
    depositPolicy,
    integrationHealth,
    technicianIdsWithUpcomingHoursOverrides,
  ] = await Promise.all([
    getServicesBySalonIdIncludingInactive(salonId),
    techniciansPromise,
    getPublicBookableServiceIds(salonId),
    getPrimaryLocation(salonId),
    // Stored rows only — `getDepositPolicyForSalon` makes no provider call on
    // any path, which is why it is safe on a page-load-frequency projection.
    getDepositPolicyForSalon({ salonId, salon }),
    // Called exactly once per projection; its two connection scalars are the
    // only thing read out of the result.
    getSalonIntegrationHealth(salonId),
    scheduleOverridesEntitled
      ? techniciansPromise.then(rows => loadUpcomingHoursOverrideTechnicianIds({
        salonId,
        // Only schedule-less technicians can be covered by an override, so
        // only they are worth asking about. An empty list short-circuits the
        // query entirely.
        technicianIds: rows
          .filter(technician => resolveWeeklySchedule(technician) === null)
          .map(technician => technician.id),
        todayKey,
      }))
      : Promise.resolve<ReadonlySet<string>>(new Set<string>()),
  ]);

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
    scheduleOverridesEntitled,
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
