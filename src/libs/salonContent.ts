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
   * No salon-level tagline field exists yet (not in the rev 3 plan's data
   * gaps table either — genuinely absent, same treatment as
   * `place.entranceInstructions`). Always null until a field/settings key is
   * added; documented as debt rather than guessed at.
   */
  specialtyLine: string | null;
  /**
   * No salon-level bio field exists yet. Always null for the same reason as
   * `specialtyLine` above — this is about the SALON's own bio, distinct from
   * `people.technicians[].bio` which is real, existing data.
   */
  bio: string | null;
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
};

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
      specialtyLine: null,
      bio: null,
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
      locations,
      address: resolvedAddress,
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
