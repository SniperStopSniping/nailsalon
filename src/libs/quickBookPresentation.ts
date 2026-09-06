/**
 * Shared Quick Book presentation contract (image-state rules, view types and
 * default-resolution helpers). The implementation lives with the onboarding
 * lab so onboarding previews and the public page apply identical rules; this
 * module gives `src` callers a stable alias.
 */
export {
  DEFAULT_COVER_FOCAL_POINT,
  DEFAULT_PORTRAIT_FOCAL_POINT,
  deriveQuickBookPresentation,
  focalPointToObjectPosition,
  normalizeQuickBookFocalPoint,
  QUICK_BOOK_COVER_TEXT_MODES,
  type QuickBookCoverSlot,
  type QuickBookCoverTextMode,
  type QuickBookFocalPoint,
  type QuickBookGalleryItem,
  quickBookMonogram,
  type QuickBookPortraitSlot,
  type QuickBookPresentation,
  type QuickBookPresentationProfile,
  resolveQuickBookCoverSlot,
  resolveQuickBookCoverText,
  resolveQuickBookGallery,
  resolveQuickBookPortraitSlot,
  resolveQuickBookSpecialties,
} from '../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/quick-book/presentation-view';
