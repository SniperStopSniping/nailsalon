import type { QuickBookLayoutDefinition } from './layouts';

export const MEDIA_LAYOUT_IDS = ["text_editorial", "text_centered", "text_booking_card", "logo_lockup", "logo_centered", "logo_rail", "profile_side", "profile_overlap", "profile_editorial", "brand_artist_split", "brand_artist_centered", "brand_artist_card", "cover_hero", "cover_split", "cover_attached", "cover_logo_float", "cover_logo_card", "cover_logo_split", "cover_profile_overlap", "cover_profile_side", "cover_profile_editorial", "complete_masthead", "complete_split", "complete_editorial"] as const;
export type MediaLayoutId = typeof MEDIA_LAYOUT_IDS[number];
export type MediaConfiguration = 'text' | 'logo' | 'profile' | 'logo_profile' | 'cover' | 'cover_logo' | 'cover_profile' | 'complete';
export type MediaLayoutDefinition = QuickBookLayoutDefinition & { id: MediaLayoutId; mediaConfiguration: MediaConfiguration; variant: 'a' | 'b' | 'c'; supportsCover: boolean; supportsProfile: boolean; supportsLogo: boolean };

export const QUICK_BOOK_MEDIA_GROUPS = [
  { id: 'text', label: 'Text Only', number: 1, cover: false, profile: false, logo: false },
  { id: 'logo', label: 'Logo', number: 2, cover: false, profile: false, logo: true },
  { id: 'profile', label: 'Profile', number: 3, cover: false, profile: true, logo: false },
  { id: 'logo_profile', label: 'Logo + Profile', number: 4, cover: false, profile: true, logo: true },
  { id: 'cover', label: 'Cover', number: 5, cover: true, profile: false, logo: false },
  { id: 'cover_logo', label: 'Cover + Logo', number: 6, cover: true, profile: false, logo: true },
  { id: 'cover_profile', label: 'Cover + Profile', number: 7, cover: true, profile: true, logo: false },
  { id: 'complete', label: 'Cover + Profile + Logo', number: 8, cover: true, profile: true, logo: true },
] as const;

type MediaDesign = Pick<MediaLayoutDefinition, 'id' | 'label' | 'description' | 'mediaConfiguration' | 'variant'>;

const DESIGNS: readonly MediaDesign[] = [
  { id: 'text_editorial', label: 'Type Editorial', description: 'An open masthead with a horizontal booking rhythm.', mediaConfiguration: 'text', variant: 'a' },
  { id: 'text_centered', label: 'Quiet Center', description: 'A centered identity and balanced practical details.', mediaConfiguration: 'text', variant: 'b' },
  { id: 'text_booking_card', label: 'Booking Card', description: 'Business identity and booking in a single framed panel.', mediaConfiguration: 'text', variant: 'c' },
  { id: 'logo_lockup', label: 'Brand Lockup', description: 'A generous logo beside your business identity.', mediaConfiguration: 'logo', variant: 'a' },
  { id: 'logo_centered', label: 'Brand Signature', description: 'A centered logo and name with a calm booking row.', mediaConfiguration: 'logo', variant: 'b' },
  { id: 'logo_rail', label: 'Brand Rail', description: 'An asymmetric logo column beside business details.', mediaConfiguration: 'logo', variant: 'c' },
  { id: 'profile_side', label: 'Artist Side', description: 'Your portrait beside a short personal introduction.', mediaConfiguration: 'profile', variant: 'a' },
  { id: 'profile_overlap', label: 'Artist Cameo', description: 'A portrait overlapping a softly tinted identity panel.', mediaConfiguration: 'profile', variant: 'b' },
  { id: 'profile_editorial', label: 'Artist Editorial', description: 'A tall portrait paired with an editorial business masthead.', mediaConfiguration: 'profile', variant: 'c' },
  { id: 'brand_artist_split', label: 'Studio & Artist', description: 'Business branding above a personal portrait and introduction.', mediaConfiguration: 'logo_profile', variant: 'a' },
  { id: 'brand_artist_centered', label: 'Artist Signature', description: 'A central portrait with a separate business signature.', mediaConfiguration: 'logo_profile', variant: 'b' },
  { id: 'brand_artist_card', label: 'Studio Panel', description: 'A logo-led identity beside a dedicated artist panel.', mediaConfiguration: 'logo_profile', variant: 'c' },
  { id: 'cover_hero', label: 'Photo Hero', description: 'A photographic masthead with readable identity over the image.', mediaConfiguration: 'cover', variant: 'a' },
  { id: 'cover_split', label: 'Photo Split', description: 'Photography and business information share a split composition.', mediaConfiguration: 'cover', variant: 'b' },
  { id: 'cover_attached', label: 'Photo Journal', description: 'An inset photo with an attached identity and booking panel.', mediaConfiguration: 'cover', variant: 'c' },
  { id: 'cover_logo_float', label: 'Brand on Cover', description: 'Your logo on photography, with booking immediately beneath.', mediaConfiguration: 'cover_logo', variant: 'a' },
  { id: 'cover_logo_card', label: 'Brand Card', description: 'A logo-led identity card attached to a photographic banner.', mediaConfiguration: 'cover_logo', variant: 'b' },
  { id: 'cover_logo_split', label: 'Brand & Cover', description: 'A dedicated business column beside a generous cover photo.', mediaConfiguration: 'cover_logo', variant: 'c' },
  { id: 'cover_profile_overlap', label: 'Artist on Cover', description: 'A portrait at the edge of your cover, paired with business identity.', mediaConfiguration: 'cover_profile', variant: 'a' },
  { id: 'cover_profile_side', label: 'Artist & Atmosphere', description: 'Cover photography with a personal portrait beside the introduction.', mediaConfiguration: 'cover_profile', variant: 'b' },
  { id: 'cover_profile_editorial', label: 'Artist Journal', description: 'An editorial masthead with distinct cover and portrait columns.', mediaConfiguration: 'cover_profile', variant: 'c' },
  { id: 'complete_masthead', label: 'Studio Masthead', description: 'A branded masthead, cover atmosphere and an overlapping artist portrait.', mediaConfiguration: 'complete', variant: 'a' },
  { id: 'complete_split', label: 'Studio Split', description: 'Your business signature beside cover imagery and artist identity.', mediaConfiguration: 'complete', variant: 'b' },
  { id: 'complete_editorial', label: 'Studio Editorial', description: 'An editorial cover with a separate logo and portrait story.', mediaConfiguration: 'complete', variant: 'c' },
];

/** Asset roles are declared once per group; compositions share the same contract. */
export const QUICK_BOOK_MEDIA_LAYOUTS: readonly MediaLayoutDefinition[] = DESIGNS.map(design => {
  const group = QUICK_BOOK_MEDIA_GROUPS.find(item => item.id === design.mediaConfiguration)!;
  return {
    ...design,
    supportsCover: group.cover,
    supportsProfile: group.profile,
    supportsLogo: group.logo,
    family: group.cover ? 'cover' : group.profile ? 'profile' : 'simple',
    portrait: group.profile ? 'essential' : 'none',
    portraitShape: group.profile ? 'tall' : 'none',
    cover: group.cover,
    coverText: false,
    story: group.profile,
    gallery: false,
    specialties: true,
    logo: group.logo ? 'shown' : 'omitted',
    facts: 'compact',
    contact: 'disclosure',
    actions: 'full',
    nameFit: 'flexible',
  };
});

export function isMediaQuickBookLayout(id: string | null | undefined): id is MediaLayoutId {
  return typeof id === 'string' && (MEDIA_LAYOUT_IDS as readonly string[]).includes(id);
}
export function getMediaQuickBookLayout(id: MediaLayoutId): MediaLayoutDefinition {
  return QUICK_BOOK_MEDIA_LAYOUTS.find(layout => layout.id === id)!;
}
