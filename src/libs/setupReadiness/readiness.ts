import { type BookingPageConfigSide, hasUnpublishedBookingPageChanges } from '@/libs/bookingPageConfig';
import type { BookingPageContentSide } from '@/libs/bookingPageContent';
import { getTemplateByKey } from '@/libs/serviceTemplateCatalog';
import { resolveWeeklySchedule } from '@/libs/weeklySchedule';

import {
  READINESS_CODES,
  READINESS_SEVERITIES,
  READINESS_WEEKDAYS,
  type ReadinessCode,
  type ReadinessItem,
  type ReadinessLink,
  type ReadinessLinkKey,
  type ReadinessServiceInput,
  type ReadinessSeverity,
  type SetupReadinessInput,
  type SetupReadinessResult,
  type Weekday,
} from './types';

/**
 * A1-3 Piece 1 — the PURE setup-readiness derivation.
 *
 * Every input is already loaded (see `readiness.server.ts`), so this module is
 * a total function over plain data: it issues no query and reads no clock
 * beyond the injected `now`. That is what makes the derivation matrix in
 * `readiness.test.ts` able to turn every code on and off with plain objects.
 *
 * It is not import-free, though: `hasUnpublishedBookingPageChanges` lives in
 * `bookingPageConfig.ts`, which imports `@/libs/DB` for its own writers. So
 * this module loads on the server only, and its tests mock `server-only` and
 * `@/libs/DB` exactly as `bookingPageConfig.test.ts` does. The client-safe
 * surface is `types.ts`, which remains type-only.
 *
 * REUSE, NEVER RE-DERIVE. Each rule below is a thin reading of an authority
 * that already exists:
 *   - `resolveWeeklySchedule` (`weeklySchedule.ts`) decides whether a
 *     technician has any working day at all, including the legacy
 *     workDays/startTime/endTime shape.
 *   - `resolveBookingHoursCeiling` (`bookingHoursCeiling.ts`) has already
 *     picked location-else-salon hours; this module reads its result, it does
 *     not re-implement the precedence.
 *   - `getDepositPolicyForSalon` (`depositPolicy.server.ts`) has already
 *     produced the nine-member inactive reason; this module only partitions
 *     it.
 *   - `getTemplateByKey` (`serviceTemplateCatalog.ts`) owns the library's
 *     default price.
 *   - `resolveBookingPageConfig` / `resolveBookingPageContent` own the
 *     draft/live sides and the Quick Book visibility resolution.
 *
 * The only free text that reaches the result is owner-authored service names.
 * Nothing here can read a client, an appointment, or a money total — the input
 * type has no field that carries one.
 */

// =============================================================================
// LINKS
// =============================================================================

/**
 * Registry keys are plain strings on the wire (the assistant validates them
 * against the owner-dashboard registry in Piece 2), but construction is
 * constrained to the closed set so a typo cannot ship a dead link.
 */
const LINKS: Record<ReadinessLinkKey, ReadinessLink> = {
  page_publish: { key: 'page_publish', label: 'Publish' },
  services: { key: 'services', label: 'Services' },
  team: { key: 'team', label: 'Team' },
  team_members: { key: 'team_members', label: 'Team members' },
  business_hours: { key: 'business_hours', label: 'Business hours' },
  booking_rules: { key: 'booking_rules', label: 'Booking rules' },
  payments: { key: 'payments', label: 'Payments' },
  page_text: { key: 'page_text', label: 'Page text' },
  page_information: { key: 'page_information', label: 'Page information' },
  page_layouts: { key: 'page_layouts', label: 'Page layouts' },
  integrations: { key: 'integrations', label: 'Integrations' },
};

function links(...keys: ReadinessLinkKey[]): ReadinessLink[] {
  return keys.map(key => ({ ...LINKS[key] }));
}

// =============================================================================
// ORDERING
// =============================================================================

const SEVERITY_RANK = new Map<ReadinessSeverity, number>(
  READINESS_SEVERITIES.map((severity, index) => [severity, index]),
);

const CODE_RANK = new Map<ReadinessCode, number>(
  READINESS_CODES.map((code, index) => [code, index]),
);

function compareItems(left: ReadinessItem, right: ReadinessItem): number {
  const bySeverity = (SEVERITY_RANK.get(left.severity) ?? 0)
    - (SEVERITY_RANK.get(right.severity) ?? 0);
  if (bySeverity !== 0) {
    return bySeverity;
  }
  return (CODE_RANK.get(left.code) ?? 0) - (CODE_RANK.get(right.code) ?? 0);
}

// =============================================================================
// SMALL HELPERS
// =============================================================================

/** The customer-facing active filter, mirroring `getServicesBySalonId`'s SQL `= true`. */
function isActiveService(service: ReadinessServiceInput): boolean {
  return service.isActive === true;
}

function isNonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/** At most ten names, in the caller's order. */
function nameSample(services: readonly ReadinessServiceInput[]): string[] {
  return services.slice(0, 10).map(service => service.name);
}

const MINIMUM_NOTICE_CEILING_MINUTES = 7 * 24 * 60;

/**
 * The four members of `DepositPolicyInactiveReason` that mean "the owner
 * started deposits and something is wrong". The other five (`disabled`,
 * `not_entitled`, `not_configured`, `collection_not_live`,
 * `currency_unsupported`) are settled owner or platform states, not unfinished
 * setup, and produce no item at all.
 */
const DEPOSIT_BLOCKING_REASONS: ReadonlySet<string> = new Set([
  'account_not_connected',
  'account_not_charge_ready',
  'readiness_never_synced',
  'undetermined',
]);

// =============================================================================
// DERIVATION
// =============================================================================

export function deriveSetupReadiness(input: SetupReadinessInput): SetupReadinessResult {
  const now = input.now ?? new Date();
  const items: ReadinessItem[] = [];

  const published = input.salon.publicationStatus === 'published';

  // The side customers are actually served: live for a published salon, draft
  // otherwise. This is the same draft/live selection `BookServicePageServer`
  // makes for the public page (there it is the owner-preview gate; here the
  // publication status is the only reader that exists).
  const activeConfigSide: BookingPageConfigSide = published
    ? input.bookingPageConfig.live
    : input.bookingPageConfig.draft;
  const activeContentSide: BookingPageContentSide = published
    ? input.bookingPageContent.live
    : input.bookingPageContent.draft;

  const activeServices = input.services.filter(isActiveService);
  const technicianSchedules = input.technicians.map(technician => ({
    id: technician.id,
    schedule: resolveWeeklySchedule(technician),
  }));

  // ---------------------------------------------------------------------------
  // not_published
  // ---------------------------------------------------------------------------
  if (!published) {
    items.push({
      code: 'not_published',
      severity: 'required',
      links: links('page_publish'),
    });
  }

  // ---------------------------------------------------------------------------
  // no_active_services
  // ---------------------------------------------------------------------------
  if (activeServices.length === 0) {
    items.push({
      code: 'no_active_services',
      severity: 'required',
      links: links('services'),
    });
  }

  // ---------------------------------------------------------------------------
  // no_active_technician — and the ONE suppression this projection performs
  // ---------------------------------------------------------------------------
  const hasActiveTechnician = input.technicians.length > 0;
  if (!hasActiveTechnician) {
    items.push({
      code: 'no_active_technician',
      severity: 'required',
      links: links('team_members'),
    });
  }

  // ---------------------------------------------------------------------------
  // services_not_bookable
  //
  // `getPublicBookableServiceIds` returns an EMPTY set when the salon has no
  // active technician (every service is unbookable, same cause as the item
  // above) and `null` when the salon is still on the legacy unrestricted model
  // (nothing is hidden, so there is nothing to report).
  // ---------------------------------------------------------------------------
  if (hasActiveTechnician && input.publiclyBookableServiceIds !== null) {
    const bookable = input.publiclyBookableServiceIds;
    const notBookable = activeServices.filter(service => !bookable.has(service.id));
    if (notBookable.length > 0) {
      items.push({
        code: 'services_not_bookable',
        severity: 'required',
        detail: { count: notBookable.length, serviceNames: nameSample(notBookable) },
        links: links('team'),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // technician_no_weekly_days
  //
  // Downgraded to `recommended` only when EVERY schedule-less technician is
  // covered by upcoming `hours`-type overrides AND the salon actually holds
  // the `staff.scheduleOverrides` entitlement — an override on an unentitled
  // salon is inert, so it must not soften the item.
  // ---------------------------------------------------------------------------
  const withoutWeeklyDays = technicianSchedules.filter(entry => entry.schedule === null);
  if (withoutWeeklyDays.length > 0) {
    const coveredByOverrides = input.scheduleOverridesEntitled
      ? withoutWeeklyDays.filter(entry =>
        input.technicianIdsWithUpcomingHoursOverrides.has(entry.id),
      )
      : [];
    const uncovered = withoutWeeklyDays.filter(entry => !coveredByOverrides.includes(entry));

    items.push(
      uncovered.length > 0
        ? {
            code: 'technician_no_weekly_days',
            severity: 'required',
            detail: { count: uncovered.length },
            links: links('team'),
          }
        : {
            code: 'technician_no_weekly_days',
            severity: 'recommended',
            detail: { count: coveredByOverrides.length, reason: 'overrides_present' },
            links: links('team'),
          },
    );
  }

  // ---------------------------------------------------------------------------
  // hours_days_without_staff / no_business_hours
  // ---------------------------------------------------------------------------
  const businessHours = input.hoursCeiling.businessHours;
  const openBusinessDays = READINESS_WEEKDAYS.filter(day => Boolean(businessHours?.[day]));
  const staffedDays = new Set<Weekday>();
  for (const entry of technicianSchedules) {
    for (const day of READINESS_WEEKDAYS) {
      if (entry.schedule?.[day]) {
        staffedDays.add(day);
      }
    }
  }

  const unstaffedOpenDays = openBusinessDays.filter(day => !staffedDays.has(day));
  if (unstaffedOpenDays.length > 0) {
    items.push({
      code: 'hours_days_without_staff',
      severity: 'recommended',
      detail: { count: unstaffedOpenDays.length, days: [...unstaffedOpenDays] },
      links: links('business_hours'),
    });
  }

  if (input.hoursCeiling.source === 'none') {
    items.push({
      code: 'no_business_hours',
      severity: 'optional',
      links: links('business_hours'),
    });
  }

  // ---------------------------------------------------------------------------
  // minimum_notice_high
  //
  // No `detail`: `count` is contractually a count of ROWS (services, days,
  // technicians), and putting a minutes value in it would let the assistant
  // read "10081" as "10081 things are wrong". The configured value lives
  // behind the `booking_rules` link.
  // ---------------------------------------------------------------------------
  if (input.bookingConfig.minimumNoticeMinutes > MINIMUM_NOTICE_CEILING_MINUTES) {
    items.push({
      code: 'minimum_notice_high',
      severity: 'recommended',
      links: links('booking_rules'),
    });
  }

  // ---------------------------------------------------------------------------
  // deposits_not_ready — see DEPOSIT_BLOCKING_REASONS above
  // ---------------------------------------------------------------------------
  if (input.depositPolicy.active) {
    items.push({
      code: 'deposits_not_ready',
      severity: 'ready',
      links: links('payments'),
    });
  } else if (
    input.depositPolicy.reason !== null
    && DEPOSIT_BLOCKING_REASONS.has(input.depositPolicy.reason)
  ) {
    items.push({
      code: 'deposits_not_ready',
      severity: 'required',
      detail: {
        reason: input.depositPolicy.reason,
        stale: input.depositPolicy.readinessStale,
      },
      links: links('payments'),
    });
  }

  // ---------------------------------------------------------------------------
  // intro_* — the bio/specialty line
  //
  // `intro_empty` reads the DRAFT side (per spec): an owner with nothing
  // written anywhere is told to write something, whether or not they have
  // published. The two presentation rules below read the ACTIVE side, because
  // they are statements about what a customer is served.
  // ---------------------------------------------------------------------------
  const draftContent = input.bookingPageContent.draft;
  if (!isNonEmpty(draftContent.bio) && !isNonEmpty(draftContent.specialtyLine)) {
    items.push({
      code: 'intro_empty',
      severity: 'recommended',
      links: links('page_text'),
    });
  }

  // `resolvePublicQuickBookProfile` is built ONLY for `layout === 'quick_book'`
  // (BookServicePageServer.tsx), and inside it the bio is emitted only when
  // `visibility.showBio` is true. Those two facts are the whole rule.
  const isQuickBook = activeConfigSide.layout === 'quick_book';
  const showBio = activeConfigSide.quickBookProfile.showBio === true;
  const activeBioPresent = isNonEmpty(activeContentSide.bio);

  if (isQuickBook && activeBioPresent && !showBio) {
    items.push({
      code: 'intro_hidden_by_visibility',
      severity: 'recommended',
      links: links('page_information'),
    });
  }

  if (!isQuickBook && activeBioPresent) {
    items.push({
      code: 'intro_not_rendered_by_layout',
      severity: 'recommended',
      links: links('page_layouts', 'team_members'),
    });
  }

  // ---------------------------------------------------------------------------
  // draft_unpublished_changes
  //
  // The spec flagged this as a candidate for omission ("if no cheap comparison
  // exists"). One DOES exist and is already shipped: the owner Website hub
  // (`src/app/[locale]/admin/website/page.tsx`) shows a "Draft changes not
  // published" line from exactly this comparison. That comparison now lives in
  // `hasUnpublishedBookingPageChanges` (`bookingPageConfig.ts`) and BOTH read
  // it, so the assistant and the hub can never disagree about whether a salon
  // has unpublished changes.
  // ---------------------------------------------------------------------------
  if (
    published
    && hasUnpublishedBookingPageChanges(input.bookingPageConfig, input.bookingPageContent)
  ) {
    items.push({
      code: 'draft_unpublished_changes',
      severity: 'recommended',
      links: links('page_publish'),
    });
  }

  // ---------------------------------------------------------------------------
  // services_at_library_prices
  // ---------------------------------------------------------------------------
  const atLibraryPrice = activeServices.filter((service) => {
    if (!service.templateKey) {
      return false;
    }
    const template = getTemplateByKey(service.templateKey);
    return template !== undefined && service.price === template.defaultPriceCents;
  });
  if (atLibraryPrice.length > 0) {
    items.push({
      code: 'services_at_library_prices',
      severity: 'recommended',
      detail: { count: atLibraryPrice.length, serviceNames: nameSample(atLibraryPrice) },
      links: links('services'),
    });
  }

  // ---------------------------------------------------------------------------
  // google_not_connected / payments_not_connected
  //
  // `not_connected` is each authority's own word for "there is no connection".
  // A Google connection in `reconnect_required` is a DIFFERENT, already-alerted
  // state and deliberately does not fire this code.
  //
  // `payments_not_connected` can co-occur with a `deposits_not_ready`
  // (`account_not_connected`) item. That is intended: the required item says
  // deposits are blocked, the optional one says payments are simply not set
  // up. No suppression is applied — the one suppression this module performs
  // is the technician/services pair above.
  // ---------------------------------------------------------------------------
  if (input.integrations.googleReadiness === 'not_connected') {
    items.push({
      code: 'google_not_connected',
      severity: 'optional',
      links: links('integrations'),
    });
  }

  if (input.integrations.stripeConnectStatus === 'not_connected') {
    items.push({
      code: 'payments_not_connected',
      severity: 'optional',
      links: links('payments'),
    });
  }

  // ---------------------------------------------------------------------------
  // customersWillSee
  // ---------------------------------------------------------------------------
  const publiclyBookableServiceCount = input.publiclyBookableServiceIds === null
    ? activeServices.length
    : activeServices.filter(service => input.publiclyBookableServiceIds!.has(service.id)).length;

  // A day is open to customers when someone works it AND the opening-hours
  // ceiling allows it. With no ceiling at all (`source === 'none'`) the
  // technician schedule is the only bound — the documented behaviour of
  // `resolveBookingHoursCeiling`.
  const openDays = READINESS_WEEKDAYS.filter(day =>
    staffedDays.has(day)
    && (input.hoursCeiling.source === 'none' || Boolean(businessHours?.[day])),
  );

  return {
    salon: {
      name: input.salon.name,
      publicationStatus: input.salon.publicationStatus,
      timezone: input.bookingConfig.timezone,
      businessMode: activeConfigSide.businessMode ?? null,
      technicianCount: input.technicians.length,
    },
    items: items.sort(compareItems),
    customersWillSee: {
      side: published ? 'live' : 'draft',
      layoutId: activeConfigSide.layout ?? null,
      rendersBio: isQuickBook && showBio,
      activeServiceCount: activeServices.length,
      publiclyBookableServiceCount,
      openDays: [...openDays],
    },
    computedAt: now.toISOString(),
  };
}
