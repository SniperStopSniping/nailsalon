import type {
  BookingPageLayout,
  QuickBookProfileVisibility,
  SectionId,
} from '@/libs/bookingPageConfig';

/**
 * Legacy standalone sections whose customer-facing responsibilities now live
 * inside Quick Book's compact profile header. Persisted presentation state is
 * intentionally left intact so switching templates cannot delete or rewrite
 * any owner choice; only the Quick Book view omits these duplicate surfaces.
 */
export const QUICK_BOOK_PROFILE_OWNED_LEGACY_SECTIONS = [
  'technicianProfile',
  'hoursLocation',
  'policies',
  'reviews',
  'socialLinks',
] as const satisfies readonly SectionId[];

const QUICK_BOOK_PROFILE_OWNED_LEGACY_SECTION_SET: ReadonlySet<SectionId>
  = new Set(QUICK_BOOK_PROFILE_OWNED_LEGACY_SECTIONS);

/**
 * A compact profile is active only after an explicit, recognized adoption.
 *
 * Resolved legacy configs deliberately carry version 0 alongside all-false
 * visibility values. Checking the booleans would therefore strip the
 * sections those salons already published; checking version 1 preserves that
 * legacy output while keeping a new all-private compact profile short.
 */
export function usesCompactQuickBookProfile(
  quickBookProfile: QuickBookProfileVisibility | null | undefined,
): boolean {
  return quickBookProfile?.version === 1;
}

export function resolveQuickBookPublicSectionOrder(
  layout: BookingPageLayout,
  sectionOrder: readonly SectionId[],
  quickBookProfile: QuickBookProfileVisibility | null | undefined,
): SectionId[] {
  if (layout !== 'quick_book' || !usesCompactQuickBookProfile(quickBookProfile)) {
    return [...sectionOrder];
  }

  return sectionOrder.filter(
    sectionId => !QUICK_BOOK_PROFILE_OWNED_LEGACY_SECTION_SET.has(sectionId),
  );
}

export function isQuickBookProfileOwnedLegacySection(
  layout: BookingPageLayout | string | null | undefined,
  sectionId: SectionId,
  quickBookProfile: QuickBookProfileVisibility | null | undefined,
): boolean {
  return layout === 'quick_book'
    && usesCompactQuickBookProfile(quickBookProfile)
    && QUICK_BOOK_PROFILE_OWNED_LEGACY_SECTION_SET.has(sectionId);
}
