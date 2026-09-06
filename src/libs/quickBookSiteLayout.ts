/**
 * Presentation-only compositions for the customer information above the
 * shared Quick Book service menu. The salon profile remains canonical; these
 * identifiers only choose how that same profile is arranged.
 *
 * The registry itself is shared with the onboarding lab (which cannot import
 * from `src`), so this module re-exports it and keeps the historical names
 * every existing caller uses.
 */
import {
  describeQuickBookLayoutCapabilities,
  getQuickBookLayout,
  getQuickBookLayoutsByFamily,
  isLegacyQuickBookLayoutId,
  isQuickBookLayoutId,
  LEGACY_QUICK_BOOK_LAYOUT_IDS,
  QUICK_BOOK_LAYOUT_FAMILIES,
  QUICK_BOOK_LAYOUT_FAMILY_LABELS,
  QUICK_BOOK_LAYOUT_IDS,
  QUICK_BOOK_LAYOUTS as QUICK_BOOK_LAYOUT_DEFINITIONS,
  type QuickBookLayoutDefinition,
  type QuickBookLayoutFamily,
  type QuickBookLayoutId,
  type QuickBookPortraitTreatment,
} from '../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/quick-book/layouts';

export {
  describeQuickBookLayoutCapabilities,
  getQuickBookLayout,
  getQuickBookLayoutsByFamily,
  isLegacyQuickBookLayoutId,
  isQuickBookLayoutId,
  LEGACY_QUICK_BOOK_LAYOUT_IDS,
  QUICK_BOOK_LAYOUT_DEFINITIONS,
  QUICK_BOOK_LAYOUT_FAMILIES,
  QUICK_BOOK_LAYOUT_FAMILY_LABELS,
  type QuickBookLayoutDefinition,
  type QuickBookLayoutFamily,
  type QuickBookPortraitTreatment,
};

/** Every selectable identifier, legacy six first, in owner-facing order. */
export const QUICK_BOOK_SITE_LAYOUTS = QUICK_BOOK_LAYOUT_IDS;

export type QuickBookSiteLayout = QuickBookLayoutId;

// Missing legacy config keeps the public header's existing clean-card
// presentation. New onboarding drafts always write their explicit selection
// (currently Compact Dropdown), so this fallback changes no chosen layout.
export const DEFAULT_QUICK_BOOK_SITE_LAYOUT: QuickBookSiteLayout = 'clean_card';

export function resolveQuickBookSiteLayout(value: unknown): QuickBookSiteLayout {
  return isQuickBookLayoutId(value) ? value : DEFAULT_QUICK_BOOK_SITE_LAYOUT;
}
