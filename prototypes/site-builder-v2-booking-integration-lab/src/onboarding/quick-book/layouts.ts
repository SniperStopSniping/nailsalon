/**
 * Quick Book site-layout registry.
 *
 * One list of presentation-only compositions for the owner information shown
 * above the shared Quick Book service menu. The six legacy identifiers are
 * persisted on live salons and must never change; every newer entry is
 * additive. Each entry declares what the composition NEEDS structurally
 * (a portrait area, a cover area) — never what the owner must upload.
 *
 *   portrait 'none'      — the layout never shows a person image.
 *   portrait 'optional'  — shown only when a public portrait exists.
 *   portrait 'essential' — the composition keeps its portrait area; a
 *                          missing or hidden portrait uses the built-in
 *                          default illustration.
 *   cover true           — the composition keeps its cover area; a missing
 *                          cover uses the built-in default cover.
 *
 * This module is dependency-free so the onboarding lab, the owner dashboard
 * and the public renderer can all import the same source of truth.
 */
export const QUICK_BOOK_LAYOUT_FAMILIES = ['simple', 'profile', 'cover'] as const;

export type QuickBookLayoutFamily = (typeof QUICK_BOOK_LAYOUT_FAMILIES)[number];

export type QuickBookPortraitTreatment = 'none' | 'optional' | 'essential';

export type QuickBookLayoutDefinition = {
  id: string;
  label: string;
  description: string;
  family: QuickBookLayoutFamily;
  /** Whether the person image area is absent, optional or composition-essential. */
  portrait: QuickBookPortraitTreatment;
  /** Shape of the portrait area when one renders. */
  portraitShape: 'circle' | 'tall' | 'none';
  /** The composition keeps a large cover-photo area. */
  cover: boolean;
  /** The composition can place writing on the cover. */
  coverText: boolean;
  /** Shows a short saved About excerpt as part of the introduction. */
  story: boolean;
  /** Shows a strip of the owner's public portfolio photos. */
  gallery: boolean;
  /** Shows saved specialties as chips or a line. */
  specialties: boolean;
  /** Identifier of the layout this one is a discoverable variation of. */
  variationOf?: string;
  /** Recommended starting option for its family. */
  recommended?: boolean;
};

export const QUICK_BOOK_LAYOUTS = [
  // ---- Simple (the six original layouts + booking-first variations) --------
  {
    id: 'compact_dropdown',
    label: 'Compact Dropdown',
    description: 'The shortest complete, booking-first profile.',
    family: 'simple',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
  },
  {
    id: 'clean_card',
    label: 'Clean Card',
    description: 'Soft details in one easy-to-scan card.',
    family: 'simple',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
    recommended: true,
  },
  {
    id: 'editorial',
    label: 'Editorial',
    description: 'Elegant typography with crisp, refined facts.',
    family: 'simple',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
  },
  {
    id: 'hub_menu',
    label: 'Hub Menu',
    description: 'Simple icon links that keep details tucked away.',
    family: 'simple',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
  },
  {
    id: 'profile_story',
    label: 'Profile Story',
    description: 'A more personal introduction before booking.',
    family: 'simple',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: true,
    gallery: false,
    specialties: false,
  },
  {
    id: 'ultra_minimal',
    label: 'Ultra Minimal',
    description: 'Only the essentials before clients choose a service.',
    family: 'simple',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
  },
  {
    id: 'clean_card_pro',
    label: 'Clean Card Pro',
    description: 'A polished identity row above a balanced details grid.',
    family: 'simple',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
    variationOf: 'clean_card',
  },
  {
    id: 'compact_details',
    label: 'Compact Details',
    description: 'Concise detail rows with expandable About and policies.',
    family: 'simple',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
    variationOf: 'compact_dropdown',
  },
  // ---- Profile-led --------------------------------------------------------
  {
    id: 'side_portrait',
    label: 'Side Portrait',
    description: 'A larger profile photo beside your name for a personal welcome.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
    recommended: true,
  },
  {
    id: 'editorial_split',
    label: 'Editorial Split',
    description: 'Bold business typography paired with a prominent portrait.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
  },
  {
    id: 'portrait_rail',
    label: 'Portrait Rail',
    description: 'A tall portrait panel on one side, your details beside it.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'tall',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
  },
  {
    id: 'floating_profile',
    label: 'Floating Profile',
    description: 'A large portrait floating in a soft shape above your details.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
  },
  {
    id: 'signature_stack',
    label: 'Signature Stack',
    description: 'Your brand, portrait and a short introduction, layered.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: true,
    gallery: false,
    specialties: true,
  },
  {
    id: 'concierge_panel',
    label: 'Concierge Panel',
    description: 'A branding row, then a larger personal introduction card.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: true,
    gallery: false,
    specialties: true,
  },
  // ---- Cover photo --------------------------------------------------------
  {
    id: 'hero_banner',
    label: 'Hero Banner',
    description: 'A large cover photo above a clear identity row.',
    family: 'cover',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
    recommended: true,
  },
  {
    id: 'profile_overlay',
    label: 'Profile Overlay',
    description: 'A centred portrait overlapping the cover photo.',
    family: 'cover',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
  },
  {
    id: 'story_intro',
    label: 'Story Intro',
    description: 'A cover photo, your identity and a short introduction.',
    family: 'cover',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: true,
    gallery: false,
    specialties: true,
  },
  {
    id: 'premium_split',
    label: 'Premium Split',
    description: 'A colour panel beside a cover photo for a refined split header.',
    family: 'cover',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
  },
  {
    id: 'hero_ribbon',
    label: 'Hero Ribbon',
    description: 'A cover photo with a curved edge and a side-anchored portrait.',
    family: 'cover',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
    variationOf: 'hero_banner',
  },
  {
    id: 'story_banner',
    label: 'Story Banner',
    description: 'Cover photo, centred portrait and a warm welcome note.',
    family: 'cover',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: true,
    gallery: false,
    specialties: true,
    variationOf: 'profile_overlay',
  },
  {
    id: 'gallery_header',
    label: 'Gallery Header',
    description: 'A cover photo followed by a strip of your portfolio.',
    family: 'cover',
    portrait: 'optional',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: false,
    gallery: true,
    specialties: true,
  },
  {
    id: 'asymmetric_luxe',
    label: 'Asymmetric Luxe',
    description: 'An offset cover, colour panel and portrait for an art-directed look.',
    family: 'cover',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
  },
] as const satisfies readonly QuickBookLayoutDefinition[];

export type QuickBookLayoutId = (typeof QUICK_BOOK_LAYOUTS)[number]['id'];

export const QUICK_BOOK_LAYOUT_IDS = QUICK_BOOK_LAYOUTS.map(layout => layout.id) as unknown as readonly [
  QuickBookLayoutId,
  ...QuickBookLayoutId[],
];

/** The six identifiers that existed before the design system. Never reorder. */
export const LEGACY_QUICK_BOOK_LAYOUT_IDS = [
  'compact_dropdown',
  'clean_card',
  'editorial',
  'hub_menu',
  'profile_story',
  'ultra_minimal',
] as const satisfies readonly QuickBookLayoutId[];

export type LegacyQuickBookLayoutId = (typeof LEGACY_QUICK_BOOK_LAYOUT_IDS)[number];

const LAYOUT_BY_ID: ReadonlyMap<string, QuickBookLayoutDefinition> = new Map(
  QUICK_BOOK_LAYOUTS.map(layout => [layout.id, layout]),
);

export const isQuickBookLayoutId = (value: unknown): value is QuickBookLayoutId =>
  typeof value === 'string' && LAYOUT_BY_ID.has(value);

export const isLegacyQuickBookLayoutId = (value: unknown): value is LegacyQuickBookLayoutId =>
  typeof value === 'string' && (LEGACY_QUICK_BOOK_LAYOUT_IDS as readonly string[]).includes(value);

export const getQuickBookLayout = (id: QuickBookLayoutId): QuickBookLayoutDefinition =>
  LAYOUT_BY_ID.get(id)!;

export const QUICK_BOOK_LAYOUT_FAMILY_LABELS: Record<QuickBookLayoutFamily, {
  title: string;
  description: string;
}> = {
  simple: {
    title: 'Simple',
    description: 'Business details first. A profile photo appears only when you show one.',
  },
  profile: {
    title: 'Profile-led',
    description: 'Introduce yourself with a prominent portrait. A default illustration is included until you add your photo.',
  },
  cover: {
    title: 'Cover photo',
    description: 'Lead with a large photo of your work or studio. A default cover is included until you add your own.',
  },
};

export const getQuickBookLayoutsByFamily = (
  family: QuickBookLayoutFamily,
): QuickBookLayoutDefinition[] => QUICK_BOOK_LAYOUTS.filter(layout => layout.family === family);

/** Short owner-facing capability labels shown beside a layout name. */
export const describeQuickBookLayoutCapabilities = (
  layout: QuickBookLayoutDefinition,
): string[] => {
  const labels: string[] = [];
  if (layout.portrait === 'essential') {
    labels.push('Features your profile');
  }
  if (layout.cover) {
    labels.push('Uses a cover photo');
  }
  if (layout.gallery) {
    labels.push('Shows your gallery');
  }
  if (layout.story) {
    labels.push('Includes your introduction');
  }
  if (layout.portrait === 'essential' || layout.cover) {
    labels.push('Default image included');
  }
  return labels;
};
