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

/**
 * How the business logo participates in a composition.
 *
 * `omitted` is a deliberate design decision, not a missing feature: a
 * portrait-led or typography-led hero can be stronger without a second brand
 * mark competing for the same row. The owner's logo is never deleted — it
 * stays on the salon record and every other layout still uses it.
 */
export type QuickBookLogoTreatment = 'shown' | 'optional' | 'omitted';

/** How the practical facts are arranged above booking, if at all. */
export type QuickBookFactsTreatment = 'grid' | 'tiles' | 'rows' | 'compact' | 'none';

/** Whether tap-to-call/email sit in the header or behind Salon details. */
export type QuickBookContactTreatment = 'shown' | 'disclosure';

/** Which secondary actions sit above booking. */
export type QuickBookActionsTreatment = 'full' | 'policies' | 'none';
/**
 * Where the saved social link lives. `inline` gives it its own row in the
 * stack above booking; `details` keeps it one tap away inside Salon details,
 * for a layout whose restraint is the point. The link itself is never dropped:
 * when Salon details has nothing of its own to hold, the link keeps its row.
 *
 * Read by the shared presentation renderer only. The six legacy layouts have
 * their own renderer and none of them declares this, so it is not yet a
 * registry-wide contract.
 */
export type QuickBookSocialTreatment = 'inline' | 'details';

/**
 * The business-name range a composition is built for. This is guidance, never
 * a gate: an owner may pick any layout with any name.
 */
export type QuickBookNameFit = 'short' | 'short_medium' | 'flexible';

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
  // ---- Content recipe -----------------------------------------------------
  // Each layout curates the owner's saved information rather than printing
  // every field. Anything a layout leaves out of its header stays reachable
  // through Salon details, About, Before you book, or the booking flow.
  logo: QuickBookLogoTreatment;
  facts: QuickBookFactsTreatment;
  contact: QuickBookContactTreatment;
  actions: QuickBookActionsTreatment;
  /** Defaults to `inline` when a layout does not say otherwise. */
  social?: QuickBookSocialTreatment;
  nameFit: QuickBookNameFit;
  /** One short, positive owner-facing suitability line. */
  guidance?: string;
  /** Identifier of the layout this one is a discoverable variation of. */
  variationOf?: string;
  /** Recommended starting option for its family. */
  recommended?: boolean;
};

export const QUICK_BOOK_LAYOUTS = [
  // ---- Simple: business details first ------------------------------------
  {
    id: 'compact_dropdown',
    label: 'Compact Dropdown',
    description: 'The shortest complete, booking-first profile.',
    family: 'simple',
    portrait: 'none',
    portraitShape: 'none',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
    logo: 'shown',
    facts: 'compact',
    contact: 'disclosure',
    actions: 'full',
    nameFit: 'flexible',
    guidance: 'Fast and booking-first',
  },
  {
    id: 'clean_card',
    label: 'Clean Card',
    description: 'Soft details in one calm, centred card.',
    family: 'simple',
    portrait: 'none',
    portraitShape: 'none',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
    logo: 'shown',
    facts: 'rows',
    contact: 'shown',
    actions: 'full',
    nameFit: 'flexible',
    guidance: 'Calm and composed',
    recommended: true,
  },
  {
    id: 'editorial',
    label: 'Editorial',
    description: 'Elegant typography with crisp, refined facts.',
    family: 'simple',
    portrait: 'none',
    portraitShape: 'none',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
    logo: 'optional',
    facts: 'rows',
    contact: 'shown',
    actions: 'full',
    nameFit: 'flexible',
    guidance: 'Typography first',
  },
  {
    id: 'hub_menu',
    label: 'Hub Menu',
    description: 'Simple tiles that lead to your details.',
    family: 'simple',
    portrait: 'none',
    portraitShape: 'none',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
    logo: 'shown',
    facts: 'tiles',
    contact: 'shown',
    actions: 'full',
    nameFit: 'flexible',
    guidance: 'Clear links to your details',
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
    logo: 'omitted',
    facts: 'rows',
    contact: 'shown',
    actions: 'full',
    nameFit: 'short_medium',
    guidance: 'Great with a profile photo',
  },
  {
    id: 'ultra_minimal',
    label: 'Ultra Minimal',
    description: 'Only the essentials before clients choose a service.',
    family: 'simple',
    portrait: 'none',
    portraitShape: 'none',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: false,
    logo: 'optional',
    facts: 'compact',
    contact: 'disclosure',
    actions: 'policies',
    nameFit: 'flexible',
    guidance: 'The least before booking',
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
    logo: 'shown',
    facts: 'tiles',
    contact: 'shown',
    actions: 'full',
    nameFit: 'short_medium',
    guidance: 'Best for short and medium names',
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
    logo: 'shown',
    facts: 'rows',
    contact: 'shown',
    actions: 'full',
    nameFit: 'short_medium',
    guidance: 'Details without the bulk',
    variationOf: 'compact_dropdown',
  },
  // ---- Profile-led: the person is the hero --------------------------------
  {
    id: 'side_portrait',
    label: 'Side Portrait',
    description: 'A large profile photo beside your name.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
    logo: 'omitted',
    facts: 'grid',
    contact: 'disclosure',
    actions: 'full',
    nameFit: 'short_medium',
    guidance: 'Best with a profile photo',
    recommended: true,
  },
  {
    id: 'editorial_split',
    label: 'Editorial Split',
    description: 'Bold typography paired with a prominent portrait.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
    logo: 'omitted',
    facts: 'compact',
    contact: 'disclosure',
    actions: 'policies',
    // This layout's whole case is restraint: a big serif name, one portrait
    // and almost nothing else. The social link keeps its place inside Salon
    // details rather than adding a fifth row to the stack.
    social: 'details',
    nameFit: 'short',
    guidance: 'Best for short names',
  },
  {
    id: 'portrait_rail',
    label: 'Portrait Rail',
    description: 'A tall portrait panel beside your details.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'tall',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
    logo: 'omitted',
    facts: 'grid',
    contact: 'disclosure',
    actions: 'full',
    nameFit: 'short_medium',
    guidance: 'Best with a profile photo',
  },
  {
    id: 'floating_profile',
    label: 'Floating Profile',
    description: 'A large portrait floating in a soft shape.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: false,
    gallery: false,
    specialties: true,
    logo: 'optional',
    facts: 'compact',
    contact: 'disclosure',
    actions: 'full',
    nameFit: 'short_medium',
    guidance: 'Your photo, front and centre',
  },
  {
    id: 'signature_stack',
    label: 'Signature Stack',
    description: 'Your brand, portrait and a short introduction.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: true,
    gallery: false,
    specialties: true,
    logo: 'optional',
    facts: 'grid',
    contact: 'disclosure',
    actions: 'policies',
    nameFit: 'short_medium',
    guidance: 'Story-led',
  },
  {
    id: 'concierge_panel',
    label: 'Concierge Panel',
    description: 'A branding row, then a personal introduction card.',
    family: 'profile',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: false,
    coverText: false,
    story: true,
    gallery: false,
    specialties: true,
    logo: 'shown',
    facts: 'tiles',
    contact: 'shown',
    actions: 'policies',
    nameFit: 'short_medium',
    guidance: 'Personal service feel',
  },
  // ---- Cover photo: the work is the hero ----------------------------------
  {
    id: 'hero_banner',
    label: 'Hero Banner',
    description: 'A large cover photo above a clear identity row.',
    family: 'cover',
    portrait: 'none',
    portraitShape: 'none',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
    logo: 'shown',
    facts: 'grid',
    contact: 'disclosure',
    actions: 'full',
    nameFit: 'short_medium',
    guidance: 'Designed around your cover photo',
    recommended: true,
  },
  {
    id: 'profile_overlay',
    label: 'Profile Overlay',
    description: 'A centred portrait overlapping your cover photo.',
    family: 'cover',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
    logo: 'shown',
    facts: 'compact',
    contact: 'disclosure',
    actions: 'policies',
    nameFit: 'short_medium',
    guidance: 'Cover plus your photo',
  },
  {
    id: 'story_intro',
    label: 'Story Intro',
    description: 'A cover photo and a short personal introduction.',
    family: 'cover',
    portrait: 'none',
    portraitShape: 'none',
    cover: true,
    coverText: true,
    story: true,
    gallery: false,
    specialties: true,
    logo: 'shown',
    facts: 'grid',
    contact: 'disclosure',
    actions: 'policies',
    nameFit: 'short_medium',
    guidance: 'Cover plus a short intro',
  },
  {
    id: 'premium_split',
    label: 'Premium Split',
    description: 'A colour panel beside a cover photo.',
    family: 'cover',
    portrait: 'none',
    portraitShape: 'none',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
    logo: 'shown',
    facts: 'tiles',
    contact: 'disclosure',
    actions: 'policies',
    nameFit: 'short',
    guidance: 'Best for short names',
  },
  {
    id: 'hero_ribbon',
    label: 'Hero Ribbon',
    description: 'A cover photo with a curved edge and a side portrait.',
    family: 'cover',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
    logo: 'shown',
    facts: 'grid',
    contact: 'disclosure',
    actions: 'full',
    nameFit: 'short_medium',
    guidance: 'Cover with a curved edge',
    variationOf: 'hero_banner',
  },
  {
    id: 'story_banner',
    label: 'Story Banner',
    description: 'Cover, centred portrait and a warm welcome note.',
    family: 'cover',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: true,
    gallery: false,
    specialties: true,
    logo: 'shown',
    facts: 'compact',
    contact: 'disclosure',
    actions: 'policies',
    nameFit: 'short_medium',
    guidance: 'Warm welcome above booking',
    variationOf: 'profile_overlay',
  },
  {
    id: 'gallery_header',
    label: 'Gallery Header',
    description: 'A cover photo followed by a strip of your work.',
    family: 'cover',
    portrait: 'none',
    portraitShape: 'none',
    cover: true,
    coverText: true,
    story: false,
    gallery: true,
    specialties: true,
    logo: 'shown',
    facts: 'compact',
    contact: 'disclosure',
    actions: 'full',
    nameFit: 'short_medium',
    guidance: 'Best for portfolios',
  },
  {
    id: 'asymmetric_luxe',
    label: 'Asymmetric Luxe',
    description: 'An offset cover and colour panel, art-directed.',
    family: 'cover',
    portrait: 'essential',
    portraitShape: 'circle',
    cover: true,
    coverText: true,
    story: false,
    gallery: false,
    specialties: true,
    logo: 'shown',
    facts: 'grid',
    contact: 'disclosure',
    actions: 'policies',
    nameFit: 'short',
    guidance: 'Art-directed and opinionated',
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

/**
 * At most two short, positive labels for a layout card. The preview is the
 * primary signal; these exist to prevent a poor choice, not to replace it.
 */
export const describeQuickBookLayoutCapabilities = (
  layout: QuickBookLayoutDefinition,
): string[] => {
  const labels: string[] = [];
  if (layout.guidance) {
    labels.push(layout.guidance);
  }
  if (layout.cover || layout.portrait === 'essential') {
    labels.push('Default image included');
  }
  return labels.slice(0, 2);
};

/**
 * Owner-only advisory when the saved business name is longer than the
 * composition is built for. It is a recommendation: selection is never
 * blocked, and nothing here reaches the customer's page.
 */
export const describeQuickBookNameAdvisory = (
  layout: QuickBookLayoutDefinition,
  businessName: string,
): string | null => {
  const length = businessName.trim().length;
  if (layout.nameFit === 'flexible') {
    return null;
  }
  const limit = layout.nameFit === 'short' ? 18 : 26;
  if (length <= limit) {
    return null;
  }
  return layout.nameFit === 'short'
    ? 'This design is built around a short business name. Yours will wrap onto several lines.'
    : 'Your business name is on the long side for this design and may wrap heavily.';
};

/** Which image roles this composition actually uses, for owner-side copy. */
export const describeQuickBookImageRoles = (
  layout: QuickBookLayoutDefinition,
): { cover: boolean; logo: boolean; portrait: boolean } => ({
  cover: layout.cover,
  logo: layout.logo !== 'omitted',
  portrait: layout.portrait !== 'none',
});
