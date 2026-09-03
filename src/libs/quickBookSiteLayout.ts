/**
 * Presentation-only compositions for the customer information above the
 * shared Quick Book service menu. The salon profile remains canonical; these
 * identifiers only choose how that same profile is arranged.
 */
export const QUICK_BOOK_SITE_LAYOUTS = [
  'compact_dropdown',
  'clean_card',
  'editorial',
  'hub_menu',
  'profile_story',
  'ultra_minimal',
] as const;

export type QuickBookSiteLayout = (typeof QUICK_BOOK_SITE_LAYOUTS)[number];

// Missing legacy config keeps the public header's existing clean-card
// presentation. New onboarding drafts always write their explicit selection
// (currently Compact Dropdown), so this fallback changes no chosen layout.
export const DEFAULT_QUICK_BOOK_SITE_LAYOUT: QuickBookSiteLayout = 'clean_card';

const QUICK_BOOK_SITE_LAYOUT_SET: ReadonlySet<string> = new Set(QUICK_BOOK_SITE_LAYOUTS);

export function resolveQuickBookSiteLayout(value: unknown): QuickBookSiteLayout {
  return typeof value === 'string' && QUICK_BOOK_SITE_LAYOUT_SET.has(value)
    ? value as QuickBookSiteLayout
    : DEFAULT_QUICK_BOOK_SITE_LAYOUT;
}
