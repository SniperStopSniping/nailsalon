import type { BookingConfig } from '@/libs/bookingConfig';
import type { BookingHoursCeiling } from '@/libs/bookingHoursCeiling';
import type { BookingPageConfig } from '@/libs/bookingPageConfig';
import type { BookingPageContent } from '@/libs/bookingPageContent';
import type { DepositPolicyInactiveReason } from '@/libs/depositPolicy';
import type { GoogleCalendarReadiness } from '@/libs/integrationHealth';
import type { WeeklySchedule } from '@/models/Schema';

/**
 * A1-3 Piece 1 — the setup-readiness projection's frozen result contract.
 *
 * These types are the ONLY thing the later assistant wiring (Piece 2) imports
 * from this module, so they live apart from the derivation that produces them.
 * `contracts.ts` re-exports them when the tool lands; nothing here depends on
 * the assistant existing.
 *
 * PRIVACY INVARIANT (enforced by `readiness.privacy.test.ts`): nothing in this
 * projection may carry client data — no client name, phone, email, note,
 * sensitivity, tag, appointment or revenue value. The derivation reads only
 * salon configuration, the salon's own services and technicians, and
 * connection status. Owner-authored service names are the only free text that
 * ever reaches the result, and they are salon catalogue content, not client
 * data.
 *
 * Every import above is `import type`, so this module compiles to nothing and
 * can be imported from any runtime — including a client component — without
 * pulling `@/libs/DB` behind it.
 */

/** The seven weekday keys, borrowed from the canonical schedule shape. */
export type Weekday = keyof WeeklySchedule;

/**
 * Canonical weekday order. Mirrors `weeklySchedule.ts`'s own (module-private)
 * `DAY_KEYS` and the `BusinessHours` field order in `bookingPolicy.ts`, so
 * `detail.days` and `customersWillSee.openDays` never depend on JSON key
 * insertion order.
 */
export const READINESS_WEEKDAYS: readonly Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * Every code this projection can emit, IN PRESENTATION ORDER within a
 * severity band. `deriveSetupReadiness` sorts by severity first and by this
 * array's index second, so the array is the ordering authority — not the
 * order the rules happen to run in.
 */
export const READINESS_CODES = [
  'not_published',
  'no_active_services',
  'services_not_bookable',
  'no_active_technician',
  'technician_no_weekly_days',
  'hours_days_without_staff',
  'no_business_hours',
  'minimum_notice_high',
  'deposits_not_ready',
  'intro_empty',
  'intro_hidden_by_visibility',
  'intro_not_rendered_by_layout',
  'draft_unpublished_changes',
  'services_at_library_prices',
  'google_not_connected',
  'payments_not_connected',
] as const;

export type ReadinessCode = (typeof READINESS_CODES)[number];

export const READINESS_SEVERITIES = [
  'required',
  'recommended',
  'optional',
  'ready',
] as const;

export type ReadinessSeverity = (typeof READINESS_SEVERITIES)[number];

/**
 * Deep-link keys. Plain strings on the wire by contract — this module does not
 * own the owner-dashboard link registry and deliberately does not import it;
 * the assistant validates each key against the registry when it wires the tool
 * up (Piece 2). The exported array is the closed set this module may emit, and
 * is what `readiness.test.ts` asserts every produced link against.
 */
export const READINESS_LINK_KEYS = [
  'page_publish',
  'services',
  'team',
  'team_members',
  'business_hours',
  'booking_rules',
  'payments',
  'page_text',
  'page_information',
  'page_layouts',
  'integrations',
] as const;

export type ReadinessLinkKey = (typeof READINESS_LINK_KEYS)[number];

export type ReadinessLink = {
  /** One of `READINESS_LINK_KEYS`; typed `string` because the registry is not this module's. */
  key: string;
  label: string;
};

export type ReadinessItemDetail = {
  /** How many rows the item is about (may exceed `serviceNames.length`). */
  count?: number;
  days?: Weekday[];
  /** At most ten, owner-authored service names. Never client data. */
  serviceNames?: string[];
  reason?: string;
  stale?: boolean;
};

export type ReadinessItem = {
  code: ReadinessCode;
  severity: ReadinessSeverity;
  detail?: ReadinessItemDetail;
  links: ReadinessLink[];
};

/**
 * What the public booking page actually presents right now — read from the
 * LIVE config side for a published salon and from the DRAFT side otherwise,
 * matching `BookServicePageServer.tsx`'s own draft/live selection.
 */
export type CustomersWillSee = {
  /** The booking-page layout id (`quick_book`, `editorial`, …). */
  layoutId: string | null;
  rendersBio: boolean;
  activeServiceCount: number;
  publiclyBookableServiceCount: number;
  openDays: Weekday[];
};

export type SetupReadinessResult = {
  salon: {
    name: string;
    publicationStatus: string;
    timezone: string;
    businessMode: string | null;
    technicianCount: number;
  };
  items: ReadinessItem[];
  /**
   * Null is part of the frozen contract but is never produced today: the
   * derivation can always resolve a config side. It is kept so a later gate
   * (a salon whose public page is not served at all) can use it without a
   * contract change.
   */
  customersWillSee: CustomersWillSee | null;
  computedAt: string;
};

// =============================================================================
// INPUT — everything the pure derivation needs, already loaded
// =============================================================================

/**
 * The salon's own service row, narrowed to the five fields the rules read.
 * Narrow BY CONSTRUCTION: a wider row would let an unrelated column drift into
 * the projection.
 */
export type ReadinessServiceInput = {
  id: string;
  name: string;
  /** `boolean | null` exactly as the column is typed; only `true` counts as active. */
  isActive: boolean | null;
  templateKey: string | null;
  /** Cents, compared against the library template's `defaultPriceCents`. */
  price: number;
};

/**
 * An ACTIVE technician, in the legacy-tolerant shape `resolveWeeklySchedule`
 * accepts. `getTechniciansBySalonId` already resolves `weeklySchedule` for its
 * callers; re-resolving here is idempotent and keeps the pure module usable
 * with a raw `technician` row too.
 */
export type ReadinessTechnicianInput = {
  id: string;
  weeklySchedule?: WeeklySchedule | null;
  workDays?: number[] | null;
  startTime?: string | null;
  endTime?: string | null;
};

/** The three fields of `getDepositPolicyForSalon`'s result the rules read. */
export type ReadinessDepositPolicyInput = {
  active: boolean;
  /** Null when active; otherwise the resolver's own inactive reason. */
  reason: DepositPolicyInactiveReason | null;
  /** `DepositPolicyForSalon.readinessStale` — advisory display only. */
  readinessStale: boolean;
};

/** Connection status as `getSalonIntegrationHealth` reports it. */
export type ReadinessIntegrationsInput = {
  /** `health.google.readiness`. */
  googleReadiness: GoogleCalendarReadiness;
  /** `health.stripeConnect.status` (`not_connected`, `charge_ready`, …). */
  stripeConnectStatus: string;
};

export type SetupReadinessInput = {
  salon: {
    name: string;
    publicationStatus: string;
  };
  /** `resolveBookingConfigFromSettings(salon.settings)`. */
  bookingConfig: BookingConfig;
  /** `resolveBookingPageConfig(salon.settings)`. */
  bookingPageConfig: BookingPageConfig;
  /** `resolveBookingPageContent(salon.settings)`. */
  bookingPageContent: BookingPageContent;
  /** `getServicesBySalonIdIncludingInactive` — inactive rows included on purpose. */
  services: readonly ReadinessServiceInput[];
  /** `getTechniciansBySalonId` — already filtered to active rows. */
  technicians: readonly ReadinessTechnicianInput[];
  /** `getPublicBookableServiceIds`; `null` means the legacy unrestricted model. */
  publiclyBookableServiceIds: ReadonlySet<string> | null;
  /** `resolveBookingHoursCeiling({ location, salonBusinessHours })`. */
  hoursCeiling: BookingHoursCeiling;
  depositPolicy: ReadinessDepositPolicyInput;
  /** `resolveEntitlement(salon.features, 'staff', 'scheduleOverrides')`. */
  scheduleOverridesEntitled: boolean;
  /** Technicians holding at least one upcoming `type: 'hours'` schedule override. */
  technicianIdsWithUpcomingHoursOverrides: ReadonlySet<string>;
  integrations: ReadinessIntegrationsInput;
  /** Injectable clock; only `computedAt` reads it. */
  now?: Date;
};
