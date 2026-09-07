/**
 * The single presentation view every Quick Book renderer consumes.
 *
 * The public page resolves it on the server from canonical, privacy-filtered
 * records; the onboarding lab adapts its draft into the same shape. Both
 * therefore apply the SAME image-state contract below:
 *
 *   no custom image        → default in composition-essential slots
 *   valid custom image     → the image with its saved focal point
 *   layout has no slot     → nothing rendered, assignment preserved elsewhere
 *   hidden real portrait   → decorative default in an essential slot only;
 *                            an optional slot renders nothing (never the
 *                            hidden image)
 */
import { getQuickBookLayout, type QuickBookLayoutId } from './layouts';

/** Percentages 0–100 from the top-left of the source image. */
export type QuickBookFocalPoint = { x: number; y: number };

export const DEFAULT_PORTRAIT_FOCAL_POINT: QuickBookFocalPoint = { x: 50, y: 40 };
export const DEFAULT_COVER_FOCAL_POINT: QuickBookFocalPoint = { x: 50, y: 50 };

export type QuickBookPortraitSlot =
  | { kind: 'custom'; url: string; alt: string; focal: QuickBookFocalPoint | null }
  | { kind: 'default' }
  | { kind: 'none' };

export type QuickBookCoverSlot =
  | { kind: 'custom'; url: string; focal: QuickBookFocalPoint | null }
  | { kind: 'default' }
  | null;

export type QuickBookGalleryItem = {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
};

export const QUICK_BOOK_COVER_TEXT_MODES = ['website_copy', 'custom', 'none'] as const;
export type QuickBookCoverTextMode = (typeof QUICK_BOOK_COVER_TEXT_MODES)[number];

export type QuickBookPresentation = {
  layoutId: QuickBookLayoutId;
  /** Saved specialties, already limited to public content. */
  specialties: string[];
  /** e.g. "Appointment only" — the real booking-method setting, or null. */
  bookingMethod: string | null;
  /** e.g. "Accepting new clients" / "Not accepting new clients", or null. */
  newClients: string | null;
  /** Writing placed on the cover, already resolved from the saved mode. */
  coverText: string | null;
  portrait: QuickBookPortraitSlot;
  cover: QuickBookCoverSlot;
  gallery: QuickBookGalleryItem[];
};

export type QuickBookPresentationProfile = {
  identity: {
    salonName: string;
    logoUrl: string | null;
    technicianName: string | null;
    technicianPhotoUrl: string | null;
  };
  location: {
    name: string | null;
    addressLine: string | null;
    localityLine: string | null;
    directionsUrl: string;
    instructionLines: string[];
  } | null;
  hours: {
    statusLabel: string;
    todayLabel: string | null;
    weekly: Array<{ day: string; value: string }>;
  } | null;
  contact: {
    phone: { actionLabel: string; display: string; href: string } | null;
    email: { display: string; href: string } | null;
  } | null;
  policies: Array<{ label: string; text: string }>;
  reviews: { ratingText: string; reviewCountText: string; href: string | null } | null;
  instagram: { label: string; href: string } | null;
  bio: string | null;
  presentation: QuickBookPresentation;
};

const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

export const normalizeQuickBookFocalPoint = (value: unknown): QuickBookFocalPoint | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x: clampPercent(x), y: clampPercent(y) };
};

export const focalPointToObjectPosition = (
  focal: QuickBookFocalPoint | null,
  fallback: QuickBookFocalPoint,
): string => {
  const point = focal ?? fallback;
  return `${point.x}% ${point.y}%`;
};

export const resolveQuickBookPortraitSlot = (input: {
  layout: QuickBookLayoutId;
  url: string | null;
  alt: string;
  focal: QuickBookFocalPoint | null;
  /** The owner's visibility decision for the real photo. */
  visible: boolean;
}): QuickBookPortraitSlot => {
  const treatment = getQuickBookLayout(input.layout).portrait;
  if (treatment === 'none') {
    return { kind: 'none' };
  }
  if (input.visible && input.url) {
    return { kind: 'custom', url: input.url, alt: input.alt, focal: input.focal };
  }
  return treatment === 'essential' ? { kind: 'default' } : { kind: 'none' };
};

export const resolveQuickBookCoverSlot = (input: {
  layout: QuickBookLayoutId;
  url: string | null;
  focal: QuickBookFocalPoint | null;
}): QuickBookCoverSlot => {
  if (!getQuickBookLayout(input.layout).cover) {
    return null;
  }
  return input.url
    ? { kind: 'custom', url: input.url, focal: input.focal }
    : { kind: 'default' };
};

export const resolveQuickBookCoverText = (input: {
  layout: QuickBookLayoutId;
  mode: QuickBookCoverTextMode;
  customText: string | null;
  websiteCopy: string | null;
}): string | null => {
  if (!getQuickBookLayout(input.layout).coverText || input.mode === 'none') {
    return null;
  }
  const source = input.mode === 'custom' ? input.customText : input.websiteCopy;
  const trimmed = source?.trim() ?? '';
  return trimmed ? trimmed.slice(0, 120) : null;
};

export const resolveQuickBookGallery = (input: {
  layout: QuickBookLayoutId;
  items: readonly QuickBookGalleryItem[];
}): QuickBookGalleryItem[] =>
  getQuickBookLayout(input.layout).gallery ? input.items.slice(0, 5) : [];

export const resolveQuickBookSpecialties = (input: {
  layout: QuickBookLayoutId;
  specialties: readonly string[] | null | undefined;
}): string[] => {
  if (!getQuickBookLayout(input.layout).specialties) {
    return [];
  }
  // Specialties come from an optional JSONB column, so a legacy row can hold
  // something that is not a list at all. An unusable value means "no
  // specialties" — it must never break the public page.
  if (!Array.isArray(input.specialties)) {
    return [];
  }
  const unique = new Set<string>();
  for (const value of input.specialties) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      unique.add(trimmed);
    }
  }
  return [...unique].slice(0, 6);
};

/** Initials for the monogram used when a business has no logo. */
export const quickBookMonogram = (name: string): string => {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const initials = parts.slice(0, 2).map(part => part[0]?.toLocaleUpperCase() ?? '').join('');
  return initials || 'L';
};

/**
 * Presentation derived from a profile that carries none (an identity-only
 * fallback, an older fixture, or a caller whose layout prop disagrees with
 * the server-resolved side). Applies the same slot rules with what the
 * profile already exposes: the public portrait, no cover, no gallery.
 */
export const deriveQuickBookPresentation = (
  profile: Omit<QuickBookPresentationProfile, 'presentation'>,
  layout: QuickBookLayoutId,
): QuickBookPresentation => ({
  layoutId: layout,
  specialties: [],
  bookingMethod: null,
  newClients: null,
  coverText: null,
  portrait: resolveQuickBookPortraitSlot({
    layout,
    url: profile.identity.technicianPhotoUrl,
    alt: profile.identity.technicianName ?? profile.identity.salonName,
    focal: null,
    visible: profile.identity.technicianPhotoUrl !== null,
  }),
  cover: resolveQuickBookCoverSlot({ layout, url: null, focal: null }),
  gallery: [],
});
