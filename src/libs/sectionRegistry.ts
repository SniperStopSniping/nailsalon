/**
 * Section registry (Luster UI/UX plan rev 3, section 4A.B).
 *
 * 12 registered modules — the closed `SectionId` set from `@/libs/bookingPageConfig`
 * (PR 2), imported rather than redefined here. Each entry exports its `id`,
 * the variant keys actually implemented in this PR, and a `canRender`
 * predicate over `SalonContent` (`@/libs/salonContent`).
 *
 * "A section whose content requirement fails is omitted, never rendered as
 * an empty frame" — every `canRender` below is the enforcement of that rule
 * for its section, not documentation of it.
 *
 * `serviceMenu` hosts the ONE shared booking engine and is never re-authored
 * per layout — this registry only decides WHETHER a section may render, never
 * HOW; the actual JSX for each section lives with its consumer (Quick Book's
 * consumer is `BookServiceClient.tsx`, which renders `serviceMenu` as a
 * single opaque, unmodified block — see that file's own comments).
 */

import type { SectionId } from '@/libs/bookingPageConfig';
import type { SalonContent } from '@/libs/salonContent';

export type SectionRegistryEntry = {
  id: SectionId;
  /**
   * Variant keys actually built in this PR — deliberately at most one today
   * ("build only the one variant Quick Book actually uses per section for
   * now"). The plan's other documented v1 variants per section are listed as
   * comments, not implemented, so a future PR extends this array rather than
   * guessing at a shape.
   */
  variants: readonly string[];
  canRender: (content: SalonContent) => boolean;
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim() !== '');
}

export const SECTION_REGISTRY: Record<SectionId, SectionRegistryEntry> = {
  salonProfile: {
    id: 'salonProfile',
    // 'hero' added in PR 6 (Editorial's hero/profile band, with a
    // documented fallback to the 'compact' identity band when no hero image
    // is set). Future: portrait.
    variants: ['compact', 'hero'],
    // "name (always satisfiable)" — a resolved salon always has a name.
    canRender: content => hasText(content.identity.name),
  },

  technicianProfile: {
    id: 'technicianProfile',
    // 'full' added in PR 6 (Editorial's About section: avatar, name,
    // specialties, languages, bio).
    variants: ['card', 'full'],
    // "≥1 tech with bio or avatar".
    canRender: content =>
      content.people.technicians.some(
        technician => hasText(technician.bio) || hasText(technician.avatarUrl),
      ),
  },

  featuredServices: {
    id: 'featuredServices',
    // Future: grid.
    variants: ['carousel'],
    // "≥1 featured service". In Quick Book this PR, featured services stay
    // structurally embedded inside the serviceMenu opaque block (the
    // existing booking-engine JSX already renders them there) — this entry
    // exists for canRender/testing and for future layouts that render
    // featuredServices as its own standalone section.
    canRender: content => content.catalog.featuredServices.length > 0,
  },

  serviceMenu: {
    id: 'serviceMenu',
    // Future: imageGrid, dense.
    variants: ['list'],
    // Non-removable (PR 2's REQUIRED_SECTION_IDS) — always renderable. With
    // zero services the existing booking engine already renders its own
    // "not ready yet" empty state rather than nothing, so the section itself
    // is never omitted.
    canRender: () => true,
  },

  whatsIncluded: {
    id: 'whatsIncluded',
    // Future: bullets, prose.
    variants: [],
    // Data gap 17 (plan section 11): no per-service inclusions field exists
    // yet, and SalonContent (this PR) does not carry one. Always omitted
    // until that field exists — never guessed at from description text.
    canRender: () => false,
  },

  technicianList: {
    id: 'technicianList',
    // Future: avatars, profileCards.
    variants: [],
    // "≥2 technicians".
    canRender: content => content.people.technicians.length >= 2,
  },

  portfolio: {
    id: 'portfolio',
    // Future: grid, masonry, strip.
    variants: [],
    // "curated images" — PR 10. content.proof.portfolio is always empty in
    // this PR, so this always resolves false (correctly omitted).
    canRender: content => content.proof.portfolio.length > 0,
  },

  reviews: {
    id: 'reviews',
    // Future: quotes, compact.
    variants: [],
    // "genuine featured review rows" — PR 10. Always empty in this PR.
    canRender: content => content.proof.reviews.length > 0,
  },

  hoursLocation: {
    id: 'hoursLocation',
    // 'full' added in PR 6 (Editorial's Visit section: location, hours, and
    // entrance instructions when present).
    variants: ['compact', 'full'],
    // "address or hours".
    canRender: content => content.place.locations.length > 0
      || content.place.address !== null
      || content.place.hours !== null,
  },

  policies: {
    id: 'policies',
    // Future: collapsed.
    variants: ['inline'],
    // "policy enabled" — mirrors bookingExperience.policy.enabled, the
    // existing per-content toggle (this section governs placement only, per
    // the plan's "does not duplicate existing content switches" rule).
    canRender: content => content.policies.policy.enabled === true,
  },

  socialLinks: {
    id: 'socialLinks',
    // Future: labelled.
    variants: ['icons'],
    // "≥1 link".
    canRender: content => Boolean(
      content.social.instagram || content.social.facebook || content.social.tiktok,
    ),
  },

  bookingCta: {
    id: 'bookingCta',
    // Future: inline, both.
    variants: ['sticky'],
    // Non-removable — the only always-available entry point into booking.
    canRender: () => true,
  },
};

/**
 * Filters a resolved `sectionOrder` (e.g. `bookingPage.{draft,live}.sectionOrder`
 * from `@/libs/bookingPageConfig`) down to the ids that are both registered
 * and satisfy their own `canRender(content)` — the same omission rule
 * `SectionOrderRenderer` (`@/components/booking/SectionOrderRenderer`)
 * applies at render time, exposed standalone so it can be asserted on
 * directly without mounting React.
 */
export function resolveVisibleSectionOrder(
  order: readonly SectionId[],
  content: SalonContent,
): SectionId[] {
  return order.filter((id) => {
    const entry = SECTION_REGISTRY[id];
    return entry !== undefined && entry.canRender(content);
  });
}

// Exported for tests/documentation that want to assert registry completeness
// against the PR 2 SectionId union. Derived from this registry's own keys
// (rather than importing bookingPageConfig's runtime SECTION_IDS constant)
// so this module only depends on that one for its *type*, keeping it free of
// bookingPageConfig's own server-only DB import chain.
export const REGISTERED_SECTION_IDS: readonly SectionId[] = Object.keys(
  SECTION_REGISTRY,
) as SectionId[];
