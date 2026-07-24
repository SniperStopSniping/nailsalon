export const PUBLIC_SERVICE_IMAGE_FALLBACK = '/assets/images/biab-short.webp';

function normalizeImageUrlValue(imageUrl: string | null | undefined): string {
  return typeof imageUrl === 'string' ? imageUrl.trim() : '';
}

function isCloudinaryServiceImageUrl(imageUrl: string): boolean {
  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === 'https:' && parsed.hostname === 'res.cloudinary.com';
  } catch {
    return false;
  }
}

const DEVELOPMENT_SERVICE_UPLOAD_URL
  = /^\/uploads\/services\/[\w-]{1,128}\/service_[\w-]{1,128}_[\w-]{16}\.webp$/;

function isDevelopmentServiceUploadUrl(imageUrl: string): boolean {
  return process.env.NODE_ENV !== 'production' && DEVELOPMENT_SERVICE_UPLOAD_URL.test(imageUrl);
}

export function isPublicServiceCustomImageUrl(imageUrl: string | null | undefined): boolean {
  const normalized = normalizeImageUrlValue(imageUrl);

  return isCloudinaryServiceImageUrl(normalized)
    || isDevelopmentServiceUploadUrl(normalized);
}

export function isUnusablePublicServiceImageUrl(imageUrl: string | null | undefined): boolean {
  const normalized = normalizeImageUrlValue(imageUrl);

  if (!normalized) {
    return true;
  }

  if (normalized.startsWith('/uploads/')) {
    return !isDevelopmentServiceUploadUrl(normalized);
  }

  if (normalized.startsWith('/public/uploads/')) {
    return true;
  }

  if (normalized.startsWith('/')) {
    return false;
  }

  return !isCloudinaryServiceImageUrl(normalized);
}

export function normalizePublicServiceImageUrl(imageUrl: string | null | undefined): string {
  if (isUnusablePublicServiceImageUrl(imageUrl)) {
    return PUBLIC_SERVICE_IMAGE_FALLBACK;
  }

  return normalizeImageUrlValue(imageUrl);
}

/*
 * Service-card artwork.
 *
 * Salons rarely upload their own photos, so without this every card fell back
 * to one image. Assignment is keyed on `template_key` (stable, canonical) and
 * only degrades to name matching for hand-created services that have no key.
 * The one hard rule: an image never crosses families — no toes on a manicure,
 * no hands-only shot on a combo.
 */

const IMG = '/assets/images/services';

export const SERVICE_IMAGE = {
  manicureGel: `${IMG}/manicure-gel-nude.webp`,
  manicureRussian: `${IMG}/manicure-russian-clean.webp`,
  manicureBare: `${IMG}/manicure-bare-natural.webp`,
  manicureBuilder: `${IMG}/manicure-builder-overlay.webp`,
  manicureLuster: `${IMG}/manicure-luster-pearl.webp`,
  manicureFrench: `${IMG}/manicure-french.webp`,
  manicureCatEye: `${IMG}/manicure-cateye.webp`,
  manicurePearl: `${IMG}/manicure-pearl-chrome.webp`,
  extensionsGelX: `${IMG}/manicure-french.webp`,
  extensionsHardGel: `${IMG}/extensions-hard-gel-burgundy.webp`,
  pedicureGel: `${IMG}/pedicure-red-luster.webp`,
  pedicureClassic: `${IMG}/pedicure-red-classic.webp`,
  pedicureFrench: `${IMG}/pedicure-french.webp`,
  pedicureToes: `${IMG}/pedicure-white-toes.webp`,
  pedicureBare: `${IMG}/pedicure-bare-natural.webp`,
  comboNude: `${IMG}/combo-nude-luster.webp`,
  comboFrench: `${IMG}/combo-french-luster.webp`,
  comboChampagne: `${IMG}/combo-taupe-luster.webp`,
  comboBuilder: `${IMG}/combo-pink-builder-luster.webp`,
} as const;

/**
 * Per-image crop override, for art whose subject sits away from the centre.
 * Empty by design: the current set is all framed for the wide, short card, so
 * a centred crop keeps every subject. Add an entry here rather than writing a
 * CSS exception in a card component.
 */
const SERVICE_IMAGE_OBJECT_POSITION: Record<string, string> = {};

export function serviceCardImagePosition(imageUrl: string | null | undefined): string | undefined {
  return SERVICE_IMAGE_OBJECT_POSITION[normalizeImageUrlValue(imageUrl)];
}

type ServiceImageFamily = 'manicure' | 'builder' | 'extensions' | 'pedicure' | 'combo';

const FAMILY_IMAGE: Record<ServiceImageFamily, string> = {
  manicure: SERVICE_IMAGE.manicureGel,
  builder: SERVICE_IMAGE.manicureBuilder,
  extensions: SERVICE_IMAGE.extensionsGelX,
  pedicure: SERVICE_IMAGE.pedicureGel,
  combo: SERVICE_IMAGE.comboNude,
};

const SERVICE_IMAGE_BY_TEMPLATE_KEY: Record<string, string> = {
  // Manicure — natural nail
  gel_manicure: SERVICE_IMAGE.manicureGel,
  classic_manicure: SERVICE_IMAGE.manicureGel,
  classic_manicure_regular_polish: SERVICE_IMAGE.manicureGel,
  express_manicure: SERVICE_IMAGE.manicureGel,
  spa_manicure: SERVICE_IMAGE.manicureGel,
  deluxe_spa_manicure: SERVICE_IMAGE.manicureGel,
  mens_manicure: SERVICE_IMAGE.manicureRussian,
  kids_manicure: SERVICE_IMAGE.manicureGel,
  colour_change_hands: SERVICE_IMAGE.manicureGel,
  regular_polish_change_hands: SERVICE_IMAGE.manicureGel,
  gel_polish_change_hands: SERVICE_IMAGE.manicureGel,
  // Manicure — dry / cuticle-focused, bare or clear nails
  russian_manicure_no_colour: SERVICE_IMAGE.manicureBare,
  classic_manicure_no_polish: SERVICE_IMAGE.manicureBare,
  nail_strengthening_treatment: SERVICE_IMAGE.manicureBare,
  japanese_manicure: SERVICE_IMAGE.manicureBare,
  ibx_treatment: SERVICE_IMAGE.manicureBare,
  gel_removal_service_hands: SERVICE_IMAGE.manicureBare,
  builder_extension_removal_service: SERVICE_IMAGE.manicureBare,
  gel_x_removal_manicure: SERVICE_IMAGE.manicureBare,
  builder_gel_removal_manicure: SERVICE_IMAGE.manicureBare,
  acrylic_removal_manicure: SERVICE_IMAGE.manicureBare,
  // Manicure — builder / structured
  builder_gel_overlay: SERVICE_IMAGE.manicureBuilder,
  builder_gel_refill: SERVICE_IMAGE.manicureBuilder,
  builder_gel_rebalance: SERVICE_IMAGE.manicureBuilder,
  biab_gel_colour: SERVICE_IMAGE.manicureGel,
  structured_gel_manicure: SERVICE_IMAGE.manicureBuilder,
  structured_gel_manicure_colour: SERVICE_IMAGE.manicureGel,
  luster_manicure: SERVICE_IMAGE.manicureLuster,
  // Extensions
  gel_x_extensions: SERVICE_IMAGE.extensionsGelX,
  gel_x_extensions_medium: SERVICE_IMAGE.extensionsGelX,
  gel_x_extensions_long: SERVICE_IMAGE.extensionsGelX,
  gel_x_extensions_extra_long: SERVICE_IMAGE.extensionsGelX,
  gel_x_fill: SERVICE_IMAGE.extensionsGelX,
  gel_x_removal_new_set: SERVICE_IMAGE.extensionsGelX,
  hard_gel_overlay: SERVICE_IMAGE.manicureBuilder,
  hard_gel_extensions: SERVICE_IMAGE.extensionsHardGel,
  hard_gel_extensions_medium: SERVICE_IMAGE.extensionsHardGel,
  hard_gel_extensions_long: SERVICE_IMAGE.extensionsHardGel,
  hard_gel_fill: SERVICE_IMAGE.extensionsHardGel,
  hard_gel_rebalance: SERVICE_IMAGE.extensionsHardGel,
  polygel_overlay: SERVICE_IMAGE.manicureBuilder,
  polygel_full_set: SERVICE_IMAGE.extensionsHardGel,
  polygel_fill: SERVICE_IMAGE.extensionsHardGel,
  acrylic_overlay: SERVICE_IMAGE.manicureBuilder,
  acrylic_full_set_short: SERVICE_IMAGE.manicurePearl,
  acrylic_full_set_medium: SERVICE_IMAGE.extensionsHardGel,
  acrylic_full_set_long: SERVICE_IMAGE.extensionsHardGel,
  acrylic_full_set_extra_long: SERVICE_IMAGE.extensionsHardGel,
  acrylic_fill: SERVICE_IMAGE.extensionsHardGel,
  acrylic_rebalance: SERVICE_IMAGE.extensionsHardGel,
  acrylic_ombre_full_set: SERVICE_IMAGE.manicurePearl,
  pink_and_white_acrylic: SERVICE_IMAGE.manicureFrench,
  dip_powder_natural: SERVICE_IMAGE.manicureGel,
  dip_powder_tips: SERVICE_IMAGE.extensionsGelX,
  dip_powder_french: SERVICE_IMAGE.manicureFrench,
  dip_powder_ombre: SERVICE_IMAGE.manicurePearl,
  dip_powder_removal: SERVICE_IMAGE.manicureBare,
  dip_powder_removal_new_set: SERVICE_IMAGE.manicurePearl,
  // Pedicure / toes
  gel_pedicure: SERVICE_IMAGE.pedicureGel,
  luster_pedicure: SERVICE_IMAGE.pedicureGel,
  deluxe_gel_pedicure: SERVICE_IMAGE.pedicureGel,
  signature_luxury_pedicure: SERVICE_IMAGE.pedicureGel,
  classic_pedicure: SERVICE_IMAGE.pedicureClassic,
  deluxe_pedicure_regular_polish: SERVICE_IMAGE.pedicureClassic,
  express_pedicure: SERVICE_IMAGE.pedicureClassic,
  spa_pedicure: SERVICE_IMAGE.pedicureClassic,
  lavender_spa_pedicure: SERVICE_IMAGE.pedicureClassic,
  jelly_pedicure: SERVICE_IMAGE.pedicureClassic,
  volcano_pedicure: SERVICE_IMAGE.pedicureClassic,
  hot_stone_pedicure: SERVICE_IMAGE.pedicureClassic,
  paraffin_pedicure: SERVICE_IMAGE.pedicureClassic,
  deluxe_spa_pedicure: SERVICE_IMAGE.pedicureClassic,
  mens_pedicure: SERVICE_IMAGE.pedicureBare,
  kids_pedicure: SERVICE_IMAGE.pedicureToes,
  regular_polish_change_toes: SERVICE_IMAGE.pedicureClassic,
  shellac_gel_toes: SERVICE_IMAGE.pedicureToes,
  gel_polish_change_toes: SERVICE_IMAGE.pedicureToes,
  french_gel_toes: SERVICE_IMAGE.pedicureFrench,
  classic_pedicure_no_polish: SERVICE_IMAGE.pedicureBare,
  russian_dry_pedicure: SERVICE_IMAGE.pedicureBare,
  toenail_trim_shape: SERVICE_IMAGE.pedicureBare,
  gel_removal_service_toes: SERVICE_IMAGE.pedicureBare,
  big_toe_extension: SERVICE_IMAGE.pedicureToes,
  full_gel_toe_extensions: SERVICE_IMAGE.pedicureToes,
  toenail_reconstruction: SERVICE_IMAGE.pedicureToes,
  // Combos — hands and feet together
  gel_mani_gel_pedi_combo: SERVICE_IMAGE.comboNude,
  classic_mani_classic_pedi_combo: SERVICE_IMAGE.comboNude,
  classic_mani_gel_pedi_combo: SERVICE_IMAGE.comboNude,
  gel_mani_classic_pedi_combo: SERVICE_IMAGE.comboNude,
  gel_manicure_gel_toes: SERVICE_IMAGE.comboNude,
  kids_mani_pedi_combo: SERVICE_IMAGE.comboNude,
  builder_gel_regular_polish_toes: SERVICE_IMAGE.comboBuilder,
  builder_gel_gel_toes: SERVICE_IMAGE.comboBuilder,
  builder_refill_gel_pedicure: SERVICE_IMAGE.comboBuilder,
  builder_refill_gel_toes: SERVICE_IMAGE.comboBuilder,
  biab_classic_pedi_combo: SERVICE_IMAGE.comboBuilder,
  biab_gel_pedi_combo: SERVICE_IMAGE.comboBuilder,
  biab_gel_colour_classic_pedi_combo: SERVICE_IMAGE.comboBuilder,
  biab_gel_colour_gel_pedi_combo: SERVICE_IMAGE.comboBuilder,
  gel_x_classic_pedi_combo: SERVICE_IMAGE.comboFrench,
  gel_x_gel_pedi_combo: SERVICE_IMAGE.comboFrench,
  hard_gel_classic_pedi_combo: SERVICE_IMAGE.comboChampagne,
  hard_gel_gel_pedi_combo: SERVICE_IMAGE.comboChampagne,
  luster_mani_classic_pedi_combo: SERVICE_IMAGE.comboChampagne,
  luster_mani_gel_pedi_combo: SERVICE_IMAGE.comboChampagne,
};

/** Longest-prefix-first, so `gel_x_` wins over `gel_`. */
const TEMPLATE_KEY_FAMILY_PREFIXES: [string, ServiceImageFamily][] = [
  ['gel_x_', 'extensions'],
  ['hard_gel_', 'extensions'],
  ['polygel_', 'extensions'],
  ['acrylic_', 'extensions'],
  ['dip_powder_', 'extensions'],
  ['builder_gel_', 'builder'],
  ['biab_', 'builder'],
  ['structured_gel_', 'builder'],
  ['luster_mani', 'manicure'],
  ['luster_pedi', 'pedicure'],
];

function normalizeServiceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Salon-authored services carry no template key, so the display name is all we
 * have. Rules are ordered — the first match wins — and each branch can only
 * return an image from the family the name already put us in.
 */
function imageFromName(name: string, bookingCategory?: string | null): string | null {
  const n = normalizeServiceName(name);
  const hasHands = /manicure|mani\b|biab|builder|gel x|gelx|hard gel|polygel|acrylic|dip powder|nails\b/.test(n);
  const hasFeet = /pedicure|pedi\b|toes|toe\b|toenail/.test(n);

  // Combo first — "Gel Manicure + Gel Pedicure" matches both halves.
  if (bookingCategory === 'combo' || (hasHands && hasFeet)) {
    if (/luster|hard gel|acrylic|polygel/.test(n)) {
      return SERVICE_IMAGE.comboChampagne;
    }

    if (/gel x|gelx|french|extension/.test(n)) {
      return SERVICE_IMAGE.comboFrench;
    }

    if (/biab|builder|structured/.test(n)) {
      return SERVICE_IMAGE.comboBuilder;
    }

    return SERVICE_IMAGE.comboNude;
  }

  if (hasFeet || bookingCategory === 'pedicure') {
    if (/french/.test(n)) {
      return SERVICE_IMAGE.pedicureFrench;
    }

    // Bare nails — showing polish on a no-polish service misleads the client.
    if (/no polish|no colour|no color|removal|trim|dry|russian|mens|men s/.test(n)) {
      return SERVICE_IMAGE.pedicureBare;
    }

    if (/shellac|gel toes|polish change|kids/.test(n)) {
      return SERVICE_IMAGE.pedicureToes;
    }

    if (/gel|luster|luxury|signature/.test(n)) {
      return SERVICE_IMAGE.pedicureGel;
    }

    return SERVICE_IMAGE.pedicureClassic;
  }

  if (/cat eye|magnetic|velvet/.test(n)) {
    return SERVICE_IMAGE.manicureCatEye;
  }

  if (/chrome|pearl|glazed|iridescent|shimmer|ombre/.test(n)) {
    return SERVICE_IMAGE.manicurePearl;
  }

  if (/french/.test(n)) {
    return SERVICE_IMAGE.manicureFrench;
  }

  if (/luster/.test(n)) {
    return SERVICE_IMAGE.manicureLuster;
  }

  if (/gel x|gelx|tips\b/.test(n)) {
    return SERVICE_IMAGE.extensionsGelX;
  }

  if (/hard gel|acrylic|polygel|extension|full set/.test(n)) {
    return SERVICE_IMAGE.extensionsHardGel;
  }

  if (/biab|builder|structured/.test(n)) {
    return SERVICE_IMAGE.manicureBuilder;
  }

  // Bare nails before the clear-gel Russian look — "No Colour" means no colour.
  if (/no polish|no colour|no color|removal|strengthen|treatment|ibx|japanese/.test(n)) {
    return SERVICE_IMAGE.manicureBare;
  }

  if (/russian|dry manicure/.test(n)) {
    return SERVICE_IMAGE.manicureRussian;
  }

  if (hasHands || bookingCategory === 'manicure') {
    return SERVICE_IMAGE.manicureGel;
  }

  return null;
}

function familyFromTemplateKey(templateKey: string): ServiceImageFamily | null {
  if (templateKey.includes('_combo') || templateKey.includes('_pedi_') || templateKey.includes('_toes')) {
    return 'combo';
  }

  const prefix = TEMPLATE_KEY_FAMILY_PREFIXES.find(([p]) => templateKey.startsWith(p));

  if (prefix) {
    return prefix[1];
  }

  if (templateKey.includes('pedicure') || templateKey.includes('toe')) {
    return 'pedicure';
  }

  if (templateKey.includes('manicure')) {
    return 'manicure';
  }

  return null;
}

type ServiceImageInput = {
  imageUrl?: string | null;
  templateKey?: string | null;
  bookingCategory?: string | null;
  name?: string | null;
};

/**
 * Resolution order: salon-uploaded image → exact template image → family
 * inferred from the template key → booking category → service name → fallback.
 */
export function resolveServiceCardImage(service: ServiceImageInput): string {
  if (!isUnusablePublicServiceImageUrl(service.imageUrl)) {
    return normalizeImageUrlValue(service.imageUrl);
  }

  const templateKey = service.templateKey?.trim() ?? '';

  if (templateKey && SERVICE_IMAGE_BY_TEMPLATE_KEY[templateKey]) {
    return SERVICE_IMAGE_BY_TEMPLATE_KEY[templateKey];
  }

  // The name is more specific than any family default, and its combo branch
  // already guarantees a hands-and-feet image, so try it before falling back.
  const nameImage = service.name ? imageFromName(service.name, service.bookingCategory) : null;

  if (nameImage) {
    return nameImage;
  }

  // A combo must never drop to a hands-only or feet-only image.
  if (service.bookingCategory === 'combo') {
    return FAMILY_IMAGE.combo;
  }

  const keyFamily = templateKey ? familyFromTemplateKey(templateKey) : null;

  if (keyFamily) {
    return FAMILY_IMAGE[keyFamily];
  }

  if (service.bookingCategory === 'manicure' || service.bookingCategory === 'pedicure') {
    return FAMILY_IMAGE[service.bookingCategory];
  }

  return PUBLIC_SERVICE_IMAGE_FALLBACK;
}
