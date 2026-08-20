/**
 * SalonContent — the content contract (Luster UI/UX plan rev 3, section 4A.A).
 *
 * "A section that takes layout-specific props cannot be shared." This module
 * is the content/layout split the section registry (`@/libs/sectionRegistry`)
 * and every future layout depend on: a single, server-resolved value grouping
 * what the salon IS (identity, people, catalog, place, policies, social,
 * proof), independent of where/how any of it is rendered.
 *
 * Resolve this ONCE per page render, server-side, and pass the result down
 * (e.g. through `SalonProvider`) — never refetch or re-derive it per section,
 * or the section registry becomes a request fan-out.
 *
 * `resolveSalonContent` is intentionally pure and DB-free: every field it
 * needs is passed in by the caller (already-fetched rows), so this module is
 * safe to import from both server components (the real, full-fidelity
 * resolution in a page.tsx) and client components (a same-shape fallback
 * resolution from whatever narrower props a component already received,
 * e.g. when the server value hasn't been threaded onto a given route yet).
 * Both call sites reuse this single function — never two implementations of
 * the same grouping.
 */

import { getFeaturedServices } from '@/libs/bookingMerchandising';
// Type-only import: `@/libs/bookingPageContent` starts with `import
// 'server-only'` (transitively `@/libs/DB`), but a `import type` is erased
// at compile time and carries no runtime code — the same safe pattern
// `BookServiceClient.tsx` and the admin booking-page route already use for
// `SectionId` from the equally server-only `@/libs/bookingPageConfig`. This
// keeps `resolveSalonContent` itself pure/DB-free (see this module's own
// doc comment above) while still sharing the one enum definition.
import type { LocationDisplayMode } from '@/libs/bookingPageContent';
import type { BusinessHours } from '@/libs/bookingPolicy';
import type { ServiceCategory } from '@/models/Schema';
import type { BookingExperience } from '@/types/salonPolicy';

// =============================================================================
// CONTENT SHAPE
// =============================================================================

export type SalonContentRating = {
  rating: number | null;
  reviewCount: number;
};

export type SalonContentIdentity = {
  name: string;
  logoUrl: string | null;
  /**
   * No salon-level tagline field exists on `salon`/`bookingExperience`
   * itself — sourced from `bookingPageContent.{draft,live}.specialtyLine`
   * (PR 5) via `ResolveSalonContentInput.content`, same as `heroImageUrl`
   * below. Always `null` when the caller does not supply one.
   */
  specialtyLine: string | null;
  /**
   * Sourced from `bookingPageContent.{draft,live}.bio` (PR 5), same path as
   * `specialtyLine` above — this is about the SALON's own bio, distinct from
   * `people.technicians[].bio` which is real, existing per-technician data
   * resolved independently below. Always `null` when the caller does not
   * supply one.
   */
  bio: string | null;
  /**
   * Hero/profile image for layouts that lead with one (Editorial — PR 6).
   * Sourced from `bookingPageContent.{draft,live}.heroImageUrl` (PR 5's
   * owner-editable field, documented there as "not yet read by
   * resolveSalonContent — wiring a reader is a follow-up PR's job"). PR 6 is
   * that follow-up: the caller resolves the active bookingPageContent side
   * and passes it through `ResolveSalonContentInput.content`, below. Always
   * `null` when the caller does not supply one (e.g. specialtyLine/bio),
   * which a consuming section must treat as "no image" and degrade — never
   * an empty frame (Rev 3 plan section 6: "A salon with no hero image
   * degrades to the Quick Book identity band").
   */
  heroImageUrl: string | null;
  /**
   * Data gap 4 (plan section 11): "No salon-level rating. Only
   * technician.rating/reviewCount. Solo borrows the sole tech's; team needs
   * an aggregate." Team aggregation is explicitly out of scope for this PR —
   * `null` for zero or multiple technicians, never guessed at or averaged.
   */
  salonRating: SalonContentRating | null;
};

export type SalonContentTechnicianInput = {
  id: string;
  name: string;
  bio?: string | null;
  avatarUrl?: string | null;
  specialties?: readonly string[] | null;
  languages?: readonly string[] | null;
  rating?: number | string | null;
  reviewCount?: number | null;
  skillLevel?: string | null;
  acceptingNewClients?: boolean | null;
  /** Callers that already filter to active technicians may omit this. */
  isActive?: boolean | null;
};

export type SalonContentTechnician = {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  specialties: string[];
  languages: string[];
  rating: number | null;
  reviewCount: number;
  skillLevel: string | null;
  acceptingNewClients: boolean;
};

export type SalonContentPeople = {
  technicians: SalonContentTechnician[];
};

export type SalonContentServiceInput = {
  id: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  priceCents: number;
  priceDisplayText?: string | null;
  category: ServiceCategory;
  bookingCategory?: string | null;
  templateKey?: string | null;
  featuredOrder?: number | null;
  sortOrder?: number | null;
  imageUrl?: string | null;
  isActive?: boolean | null;
};

export type SalonContentService = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  priceDisplayText: string | null;
  category: ServiceCategory;
  bookingCategory: string | null;
  imageUrl: string | null;
  featuredOrder: number | null;
};

export type SalonContentAddOnInput = {
  id: string;
  name: string;
  category: string;
  pricingType: string;
  durationMinutes: number;
  priceCents: number;
  priceDisplayText?: string | null;
  isActive?: boolean | null;
};

export type SalonContentAddOn = {
  id: string;
  name: string;
  category: string;
  pricingType: string;
  durationMinutes: number;
  priceCents: number;
  priceDisplayText: string | null;
};

export type SalonContentCatalog = {
  services: SalonContentService[];
  addOns: SalonContentAddOn[];
  /**
   * Reuses `getFeaturedServices` (`@/libs/bookingMerchandising`) — never
   * reimplemented — so this always agrees with whatever the booking engine
   * itself would feature for the same inputs.
   */
  featuredServices: SalonContentService[];
};

export type SalonContentLocationInput = {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  phone?: string | null;
  isPrimary?: boolean | null;
  businessHours?: BusinessHours;
};

export type SalonContentLocation = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  isPrimary: boolean;
  hours: BusinessHours | null;
};

export type SalonContentPlace = {
  locations: SalonContentLocation[];
  address: {
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  } | null;
  hours: BusinessHours | null;
  /**
   * Data gap 6 (plan section 11): "Entrance instructions have no field...
   * Settings JSONB is the cheap path" (for a later PR). Always null here.
   */
  entranceInstructions: string | null;
};

export type SalonContentPolicies = {
  policy: BookingExperience['policy'];
  quickFacts: BookingExperience['quickFacts'];
};

export type SalonContentSocial = {
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
};

export type SalonContentProof = {
  /** Data gap 2: no portfolio model yet (PR 10). Always empty in this PR. */
  portfolio: never[];
  /** Data gap 3: no featured-review concept yet (PR 10). Always empty. */
  reviews: never[];
};

export type SalonContent = {
  identity: SalonContentIdentity;
  people: SalonContentPeople;
  catalog: SalonContentCatalog;
  place: SalonContentPlace;
  policies: SalonContentPolicies;
  social: SalonContentSocial;
  proof: SalonContentProof;
};

// =============================================================================
// RESOLUTION
// =============================================================================

export type ResolveSalonContentInput = {
  salon: {
    name: string;
    logoUrl?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    businessHours?: BusinessHours;
  };
  technicians: readonly SalonContentTechnicianInput[];
  services: readonly SalonContentServiceInput[];
  addOns?: readonly SalonContentAddOnInput[];
  locations?: readonly SalonContentLocationInput[];
  bookingExperience: {
    policy: BookingExperience['policy'];
    quickFacts: BookingExperience['quickFacts'];
    socialLinks: BookingExperience['socialLinks'];
  };
  /** Forwarded verbatim to `getFeaturedServices`; see its own doc comment. */
  lusterFeaturingEnabled?: boolean;
  /**
   * PR 5's owner-editable `bookingPageContent` fields (heroImageUrl,
   * specialtyLine, bio) — genuinely new content with no prior storage, kept
   * as its own optional input rather than folded into `salon` above so a
   * caller that has not resolved `bookingPageContent` yet (most call sites,
   * until they thread it through) simply omits this and gets today's
   * behaviour: all three stay `null`, unchanged from before this field
   * existed. The one real caller (`book/service/page.tsx`, PR 6) resolves
   * the active draft/live `bookingPageContent` side the same way it already
   * resolves the active `bookingPage` side, and passes it here.
   */
  content?: {
    heroImageUrl?: string | null;
    specialtyLine?: string | null;
    bio?: string | null;
    /**
     * PR 5's `bookingPageContent.{draft,live}.locationDisplayMode` — the
     * owner's location-privacy choice. Threaded through the same
     * `salonContentInput.content` path as `heroImageUrl`/`specialtyLine`/
     * `bio` above (the caller resolves the active draft/live
     * `bookingPageContent` side and passes its `locationDisplayMode`
     * straight through). Defaults to `'full_address'` (today's behaviour,
     * unchanged) when the caller omits it. This is the server-side privacy
     * projection point: `'city_only'` strips street address/unit and
     * postal/ZIP from `place.address`, and strips street address/unit,
     * postal/ZIP, AND phone from every entry of `place.locations` (each
     * carries its own `phone` — see `SalonContentLocation`), before this
     * function ever returns — never a cosmetic, render-time hide. See
     * `applyLocationDisplayMode` below.
     */
    locationDisplayMode?: LocationDisplayMode;
  };
};

/**
 * The one server-side location-privacy projection: strips `address` (street
 * address, including any unit/suite — those are not separate fields in this
 * schema, they live inside the free-text `address` string), `zipCode`
 * (postal codes materially narrow a private residence), and — when the
 * value being projected carries one — `phone` (post-launch privacy fix: for
 * a home-based solo technician, the most likely `city_only` user, the salon
 * phone IS the personal mobile tied to that same private residence; a
 * control named "city only" that still publishes the exact number is a
 * broken promise) whenever `mode === 'city_only'`. `city`/`state`/`name`/
 * every other field on `T` pass through untouched — enough to still book
 * at, never a full redaction. `full_address` is a no-op (today's behaviour,
 * byte-for-byte).
 *
 * `phone` is optional in `T`'s constraint — plenty of callers (the plain
 * `{ address, city, state, zipCode }` shape `resolveSalonContent` uses for
 * its salon-level `place.address` fallback, `book/confirm/page.tsx`'s
 * `locationSummary`/`salonDirectionsFallback`) never had a `phone` field at
 * all, and this function must stay a no-op on the field's mere ABSENCE —
 * only a value that actually carries `phone` gets it redacted, checked via
 * `hasOwnProperty` rather than unconditionally adding the key (which would
 * silently change the shape of every caller that never had one).
 *
 * Generic and exported so every public "location"/"phone" surface that
 * lives outside `resolveSalonContent`'s own `place.{address,locations}`
 * output — `book/service/page.tsx`'s separate `locations` prop passed
 * straight to `BookServiceClient`'s location picker, built from raw DB rows
 * rather than routed through this function — can apply the exact same
 * redaction rather than a second, possibly-drifting implementation. Both
 * call sites are server components/modules, so the projection always
 * happens before the location data reaches the public client. See also
 * `applyPhoneDisplayMode` below, the scalar counterpart for callers that
 * only have a bare phone string (not a full location-shaped object) in
 * hand.
 */
export function applyLocationDisplayMode<T extends { address: string | null; zipCode: string | null; phone?: string | null }>(
  value: T,
  mode: LocationDisplayMode,
): T {
  if (mode !== 'city_only') {
    return value;
  }
  const redacted = { ...value, address: null, zipCode: null };
  if (Object.prototype.hasOwnProperty.call(value, 'phone')) {
    (redacted as { phone: string | null }).phone = null;
  }
  return redacted;
}

/**
 * Scalar counterpart to `applyLocationDisplayMode` for callers that only
 * have a bare phone string in hand — not a full location-shaped object —
 * e.g. `salon.phone` threaded straight into a public client prop
 * (`book/confirm/page.tsx`'s `salonPhone`, `find-booking/page.tsx`'s
 * `salonPhone`). Reuses the exact same `mode !== 'city_only'` rule via
 * `applyLocationDisplayMode` itself, wrapped in a throwaway
 * location-shaped object purely to reuse that one implementation — never a
 * second, independently-decided redaction rule.
 */
export function applyPhoneDisplayMode(phone: string | null, mode: LocationDisplayMode): string | null {
  return applyLocationDisplayMode({ address: null, zipCode: null, phone }, mode).phone ?? null;
}

/**
 * S6b (Stage 1) — the only salon identity this STATUS PAGE COMPONENT renders.
 *
 * Scope note, so the next reader does not over-trust this: it is not the whole
 * exposure surface of those routes. `[locale]/[slug]/layout.tsx` already wraps
 * every route beneath it in a `'use client'` `SalonProvider` that serializes
 * salonId, salonName, salonSlug, themeKey, the internal status enum and the
 * resolved bookingPage side to any visitor who reaches the layout. This
 * projection governs what the status page itself draws; auditing the layout
 * payload is separate, unchanged by Stage 1, and recorded in the register.
 *
 * `/booking-disabled`, `/suspended` and `/cancelled` are reached only AFTER the
 * publication check has passed (`checkSalonStatus` evaluates publication before
 * status), so these URLs already disclose that the salon exists. Rendering the
 * salon's name there is therefore not a new disclosure — it just stops the page
 * looking like it belongs to no one.
 *
 * The projection is deliberately narrow and is built field-by-field, never by
 * spreading a salon row:
 *   - `name` only.
 *   - `locationLabel` is city/state ONLY, and never a street address or postal
 *     code under ANY display mode — a status page has no need for either, so
 *     the conservative shape is also the correct one. Under `city_only` this is
 *     exactly what the owner already agreed to publish.
 *   - `null` when the salon has no public city. Nothing is ever fabricated.
 *   - phone and email are never included.
 *
 * NOT used on `/not-found`. That destination is shared by "salon does not
 * exist" and "salon exists but is unpublished", so adding identity there would
 * turn it into an existence oracle for draft salons at guessed slugs.
 */
export type PublicSalonStatusIdentity = {
  name: string;
  locationLabel: string | null;
};

export function resolvePublicSalonStatusIdentity(input: {
  name: string;
  city: string | null | undefined;
  state: string | null | undefined;
}): PublicSalonStatusIdentity {
  const city = typeof input.city === 'string' && input.city.trim() !== ''
    ? input.city.trim()
    : null;
  const state = typeof input.state === 'string' && input.state.trim() !== ''
    ? input.state.trim()
    : null;

  const locationLabel = city
    ? (state ? `${city}, ${state}` : city)
    : null;

  return { name: input.name, locationLabel };
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveTechnician(input: SalonContentTechnicianInput): SalonContentTechnician {
  return {
    id: input.id,
    name: input.name,
    bio: input.bio ?? null,
    avatarUrl: input.avatarUrl ?? null,
    specialties: input.specialties ? [...input.specialties] : [],
    languages: input.languages ? [...input.languages] : [],
    rating: toNumberOrNull(input.rating),
    reviewCount: input.reviewCount ?? 0,
    skillLevel: input.skillLevel ?? null,
    acceptingNewClients: input.acceptingNewClients ?? true,
  };
}

function resolveSalonRating(
  technicians: readonly SalonContentTechnicianInput[],
): SalonContentRating | null {
  const active = technicians.filter(technician => technician.isActive !== false);
  // Solo borrows the sole technician's rating; team aggregation is out of
  // scope for this PR (see SalonContentIdentity.salonRating doc comment).
  if (active.length !== 1) {
    return null;
  }
  const [sole] = active;
  if (!sole) {
    return null;
  }
  return {
    rating: toNumberOrNull(sole.rating),
    reviewCount: sole.reviewCount ?? 0,
  };
}

function resolveService(input: SalonContentServiceInput): SalonContentService {
  return {
    id: input.id,
    name: input.name,
    description: input.description ?? null,
    durationMinutes: input.durationMinutes,
    priceCents: input.priceCents,
    priceDisplayText: input.priceDisplayText ?? null,
    category: input.category,
    bookingCategory: input.bookingCategory ?? null,
    imageUrl: input.imageUrl ?? null,
    featuredOrder: input.featuredOrder ?? null,
  };
}

function resolveAddOn(input: SalonContentAddOnInput): SalonContentAddOn {
  return {
    id: input.id,
    name: input.name,
    category: input.category,
    pricingType: input.pricingType,
    durationMinutes: input.durationMinutes,
    priceCents: input.priceCents,
    priceDisplayText: input.priceDisplayText ?? null,
  };
}

function resolveLocation(input: SalonContentLocationInput): SalonContentLocation {
  return {
    id: input.id,
    name: input.name,
    address: input.address ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    zipCode: input.zipCode ?? null,
    phone: input.phone ?? null,
    isPrimary: input.isPrimary ?? false,
    hours: input.businessHours ?? null,
  };
}

export function resolveSalonContent(input: ResolveSalonContentInput): SalonContent {
  const locationDisplayMode: LocationDisplayMode = input.content?.locationDisplayMode ?? 'full_address';
  const technicians = input.technicians.map(resolveTechnician);
  const services = input.services.map(resolveService);
  const servicesById = new Map(services.map(service => [service.id, service]));
  const addOns = (input.addOns ?? []).map(resolveAddOn);
  const locations = (input.locations ?? []).map(resolveLocation);
  const primaryLocation = locations.find(location => location.isPrimary) ?? locations[0] ?? null;
  const hasSalonLevelAddress = Boolean(
    input.salon.address || input.salon.city || input.salon.state || input.salon.zipCode,
  );
  const resolvedAddress = primaryLocation
    ? {
        address: primaryLocation.address,
        city: primaryLocation.city,
        state: primaryLocation.state,
        zipCode: primaryLocation.zipCode,
      }
    : hasSalonLevelAddress
      ? {
          address: input.salon.address ?? null,
          city: input.salon.city ?? null,
          state: input.salon.state ?? null,
          zipCode: input.salon.zipCode ?? null,
        }
      : null;

  // Reuse getFeaturedServices verbatim (never reimplemented) against the
  // *raw* input rows, since it needs sortOrder/templateKey/isActive that
  // SalonContentService intentionally does not expose. Its own return order
  // is preserved by mapping straight back through servicesById.
  const featuredServices = getFeaturedServices(
    input.services.map(service => ({
      id: service.id,
      name: service.name,
      category: service.category,
      sortOrder: service.sortOrder ?? null,
      featuredOrder: service.featuredOrder ?? null,
      templateKey: service.templateKey ?? null,
      isActive: service.isActive ?? null,
    })),
    { lusterFeaturingEnabled: input.lusterFeaturingEnabled },
  )
    .map(service => servicesById.get(service.id))
    .filter((service): service is SalonContentService => Boolean(service));

  return {
    identity: {
      name: input.salon.name,
      logoUrl: input.salon.logoUrl ?? null,
      specialtyLine: input.content?.specialtyLine ?? null,
      bio: input.content?.bio ?? null,
      heroImageUrl: input.content?.heroImageUrl ?? null,
      salonRating: resolveSalonRating(input.technicians),
    },
    people: {
      technicians,
    },
    catalog: {
      services,
      addOns,
      featuredServices,
    },
    place: {
      // Projected AFTER `primaryLocation`/`resolvedAddress` above are
      // computed from the raw, unprojected `locations` — `hours` still needs
      // the real primary location, and `resolvedAddress`'s own
      // primary-vs-salon-level fallback logic must run before redaction, not
      // choose between two already-redacted candidates.
      locations: locations.map(location => applyLocationDisplayMode(location, locationDisplayMode)),
      address: resolvedAddress ? applyLocationDisplayMode(resolvedAddress, locationDisplayMode) : null,
      hours: primaryLocation?.hours ?? input.salon.businessHours ?? null,
      entranceInstructions: null,
    },
    policies: {
      policy: input.bookingExperience.policy,
      quickFacts: input.bookingExperience.quickFacts,
    },
    social: {
      instagram: input.bookingExperience.socialLinks.instagram ?? null,
      facebook: input.bookingExperience.socialLinks.facebook ?? null,
      tiktok: input.bookingExperience.socialLinks.tiktok ?? null,
    },
    proof: {
      portfolio: [],
      reviews: [],
    },
  };
}

/**
 * Safe, always-renderable empty value. Used as the `SalonProvider` default
 * (an un-provisioned context should never crash a consumer) and as a
 * starting point for partial test fixtures. `identity.name` is deliberately
 * `''` — callers resolving real content always have a real salon name, so
 * this only shows up when something genuinely has not resolved content yet.
 */
export const EMPTY_SALON_CONTENT: SalonContent = {
  identity: {
    name: '',
    logoUrl: null,
    specialtyLine: null,
    bio: null,
    heroImageUrl: null,
    salonRating: null,
  },
  people: {
    technicians: [],
  },
  catalog: {
    services: [],
    addOns: [],
    featuredServices: [],
  },
  place: {
    locations: [],
    address: null,
    hours: null,
    entranceInstructions: null,
  },
  policies: {
    policy: {
      enabled: false,
      title: null,
      text: null,
      showOnServicePage: true,
      showBeforeConfirmation: true,
      showAfterConfirmation: true,
      showInConfirmationEmail: true,
    },
    quickFacts: {
      appointmentOnly: { enabled: false, label: null },
      depositNotice: { enabled: false, label: null },
      cancellationNotice: { enabled: false, label: null },
    },
  },
  social: {
    instagram: null,
    facebook: null,
    tiktok: null,
  },
  proof: {
    portfolio: [],
    reviews: [],
  },
};
