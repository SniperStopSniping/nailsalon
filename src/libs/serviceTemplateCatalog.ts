/**
 * Global service-template library (owner-facing only).
 *
 * Templates are in-code, versioned records — never shown to clients directly.
 * Adding one creates an independent salon-owned `service`/`add_on` row linked
 * back via `template_key`, which is also how duplicates are prevented (partial
 * unique index per salon). Editing this catalog later never touches services
 * salons already created from it.
 */

import { LUSTER_MANICURE_TEMPLATE_KEY } from '@/libs/bookingMerchandising';
import type { AddOnCategory, BookingCategory, ServiceCategory } from '@/models/Schema';

export const SERVICE_TEMPLATE_CATEGORIES = [
  'popular',
  'gel_natural',
  'extensions',
  'pedicure',
  'combos',
  'nail_art',
  'removal_repair',
  'spa',
  'acrylic_dip',
] as const;

export type ServiceTemplateCategory = (typeof SERVICE_TEMPLATE_CATEGORIES)[number];

export type ServiceTemplate = {
  systemKey: string;
  name: string;
  description: string | null;
  defaultPriceCents: number;
  priceDisplayText: string | null;
  defaultDurationMinutes: number;
  /** Library shelf (never 'popular' — Popular is a curated view, not a shelf). */
  templateCategory: Exclude<ServiceTemplateCategory, 'popular'>;
  bookingCategory: BookingCategory;
  serviceCategory: ServiceCategory;
  serviceType: 'base_service' | 'combo' | 'addon';
  /** Present ⇒ shown in the Popular Services view, ascending. */
  popularityRank?: number;
  /** Seeded for brand-new salons (never acrylic/dip). */
  isRecommendedStarter?: boolean;
  /** Seeds the service with the introductory-price badge enabled. */
  isIntroPrice?: boolean;
  /** Badge label seeded alongside `isIntroPrice` (e.g. "Intro price"). */
  introPriceLabel?: string | null;
  searchAliases?: string[];
  // addon-only fields
  addOnCategory?: AddOnCategory;
  pricingType?: 'fixed' | 'per_unit';
  unitLabel?: string | null;
  maxQuantity?: number | null;
  /** Starter services this starter add-on is wired to at seed time. */
  compatibleTemplateKeys?: string[];
};

type RowOptions = Partial<
  Pick<
    ServiceTemplate,
    | 'description'
    | 'popularityRank'
    | 'isRecommendedStarter'
    | 'isIntroPrice'
    | 'introPriceLabel'
    | 'searchAliases'
    | 'serviceCategory'
    | 'bookingCategory'
    | 'addOnCategory'
    | 'pricingType'
    | 'unitLabel'
    | 'maxQuantity'
    | 'compatibleTemplateKeys'
  >
>;

/** [systemKey, name, defaultPriceCents, priceDisplayText, defaultDurationMinutes, options?] */
type Row = [string, string, number, string | null, number, RowOptions?];

function expand(
  rows: Row[],
  defaults: {
    templateCategory: Exclude<ServiceTemplateCategory, 'popular'>;
    bookingCategory: BookingCategory;
    serviceCategory: ServiceCategory;
    serviceType: ServiceTemplate['serviceType'];
    addOnCategory?: AddOnCategory;
  },
): ServiceTemplate[] {
  return rows.map(([systemKey, name, defaultPriceCents, priceDisplayText, defaultDurationMinutes, options = {}]) => ({
    systemKey,
    name,
    description: options.description ?? null,
    defaultPriceCents,
    priceDisplayText,
    defaultDurationMinutes,
    templateCategory: defaults.templateCategory,
    bookingCategory: options.bookingCategory ?? defaults.bookingCategory,
    serviceCategory: options.serviceCategory ?? defaults.serviceCategory,
    serviceType: defaults.serviceType,
    ...(defaults.serviceType === 'addon'
      ? {
          addOnCategory: options.addOnCategory ?? defaults.addOnCategory ?? 'nail_art',
          pricingType: options.pricingType ?? 'fixed',
          unitLabel: options.unitLabel ?? null,
          maxQuantity: options.maxQuantity ?? null,
        }
      : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.popularityRank !== undefined ? { popularityRank: options.popularityRank } : {}),
    ...(options.isRecommendedStarter ? { isRecommendedStarter: true } : {}),
    ...(options.isIntroPrice ? { isIntroPrice: true } : {}),
    ...(options.introPriceLabel !== undefined ? { introPriceLabel: options.introPriceLabel } : {}),
    ...(options.searchAliases ? { searchAliases: options.searchAliases } : {}),
    ...(options.compatibleTemplateKeys ? { compatibleTemplateKeys: options.compatibleTemplateKeys } : {}),
  }));
}

const BIAB_ALIASES = ['biab', 'builder gel', 'overlay'];
const GEL_POLISH_ALIASES = ['shellac', 'gel polish'];
const TIPS_ALIASES = ['tips'];

const STARTER_HAND_KEYS = [
  LUSTER_MANICURE_TEMPLATE_KEY,
  'russian_manicure_no_colour',
  'gel_manicure',
  'builder_gel_overlay',
  'builder_gel_refill',
  'gel_x_extensions',
  'hard_gel_extensions',
];
const STARTER_EXTENSION_KEYS = ['gel_x_extensions', 'hard_gel_extensions'];
const STARTER_PEDI_KEYS = ['classic_pedicure', 'gel_pedicure'];
const STARTER_COMBO_KEYS = [
  'classic_mani_classic_pedi_combo',
  'gel_mani_gel_pedi_combo',
  'biab_classic_pedi_combo',
  'biab_gel_pedi_combo',
];

// ---------------------------------------------------------------------------
// Gel & Natural Nail Services
// ---------------------------------------------------------------------------
const GEL_NATURAL = expand([
  [LUSTER_MANICURE_TEMPLATE_KEY, 'Luster Manicure', 5500, null, 60, {
    description: 'A premium structured manicure using Luster professional products.',
    isRecommendedStarter: true,
    isIntroPrice: true,
    introPriceLabel: 'Intro price',
    popularityRank: 1,
    searchAliases: ['luster', 'structured manicure'],
  }],
  ['russian_manicure_no_colour', 'Russian Manicure — No Colour', 3500, null, 45, {
    description: 'Detailed dry manicure and precise cuticle preparation.',
    isRecommendedStarter: true,
    popularityRank: 2,
    searchAliases: ['dry manicure'],
  }],
  ['gel_manicure', 'Gel Manicure', 4000, null, 60, {
    description: 'Russian manicure preparation finished with gel colour.',
    isRecommendedStarter: true,
    popularityRank: 3,
    searchAliases: GEL_POLISH_ALIASES,
  }],
  ['classic_manicure', 'Classic Manicure', 3500, null, 45],
  ['express_manicure', 'Express Manicure', 2500, null, 30],
  ['spa_manicure', 'Spa Manicure', 5000, null, 60],
  ['deluxe_spa_manicure', 'Deluxe Spa Manicure', 6000, null, 75],
  ['mens_manicure', 'Men’s Manicure', 3500, null, 45],
  ['kids_manicure', 'Kids’ Manicure', 2000, null, 30],
  ['nail_strengthening_treatment', 'Nail Strengthening Treatment', 3500, null, 45],
  ['japanese_manicure', 'Japanese Manicure', 4500, null, 60],
  ['ibx_treatment', 'IBX Treatment', 4000, null, 45],
  ['colour_change_hands', 'Colour Change — Hands', 2500, null, 30],
  ['regular_polish_change_hands', 'Regular Polish Change — Hands', 2000, null, 25],
  ['gel_polish_change_hands', 'Gel Polish Change — Hands', 3000, null, 40, { searchAliases: GEL_POLISH_ALIASES }],
  ['builder_gel_overlay', 'BIAB / Builder Gel Overlay', 5000, null, 90, {
    description: 'Builder gel overlay on natural nails for strength and structure.',
    isRecommendedStarter: true,
    popularityRank: 4,
    serviceCategory: 'builder_gel',
    searchAliases: BIAB_ALIASES,
  }],
  ['biab_gel_colour', 'BIAB + Gel Colour', 6000, null, 90, { serviceCategory: 'builder_gel', searchAliases: BIAB_ALIASES }],
  ['builder_gel_refill', 'BIAB / Builder Gel Refill', 5000, null, 90, {
    description: 'Maintenance and rebalance of an existing builder gel overlay.',
    isRecommendedStarter: true,
    popularityRank: 5,
    serviceCategory: 'builder_gel',
    searchAliases: [...BIAB_ALIASES, 'fill', 'infill'],
  }],
  ['structured_gel_manicure', 'Structured Gel Manicure', 6000, null, 90, { serviceCategory: 'builder_gel', searchAliases: BIAB_ALIASES }],
  ['structured_gel_manicure_colour', 'Structured Gel Manicure + Colour', 6500, null, 105, { serviceCategory: 'builder_gel', searchAliases: BIAB_ALIASES }],
  ['builder_gel_rebalance', 'Builder Gel Rebalance', 6500, '$65+', 105, { serviceCategory: 'builder_gel', searchAliases: BIAB_ALIASES }],
], {
  templateCategory: 'gel_natural',
  bookingCategory: 'manicure',
  serviceCategory: 'manicure',
  serviceType: 'base_service',
});

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------
const EXTENSIONS = expand([
  ['gel_x_extensions', 'Gel-X Extensions', 7000, '$70+', 120, {
    description: 'Soft-gel extensions with your chosen shape and length.',
    isRecommendedStarter: true,
    popularityRank: 6,
    searchAliases: [...TIPS_ALIASES, 'gelx', 'soft gel'],
  }],
  ['gel_x_extensions_medium', 'Gel-X Extensions — Medium', 8000, '$80+', 135, { searchAliases: TIPS_ALIASES }],
  ['gel_x_extensions_long', 'Gel-X Extensions — Long', 9000, '$90+', 150, { searchAliases: TIPS_ALIASES }],
  ['gel_x_extensions_extra_long', 'Gel-X Extensions — Extra Long', 10500, '$105+', 165, { searchAliases: TIPS_ALIASES }],
  ['gel_x_fill', 'Gel-X Fill', 6000, '$60+', 105],
  ['gel_x_removal_new_set', 'Gel-X Removal + New Set', 8500, '$85+', 150],
  ['hard_gel_overlay', 'Hard Gel Overlay', 6000, '$60+', 105],
  ['hard_gel_extensions', 'Hard Gel Extensions', 7000, '$70+', 120, {
    description: 'Structured hard-gel extensions with your chosen shape and length.',
    isRecommendedStarter: true,
    popularityRank: 7,
    searchAliases: TIPS_ALIASES,
  }],
  ['hard_gel_extensions_medium', 'Hard Gel Extensions — Medium', 8500, '$85+', 150],
  ['hard_gel_extensions_long', 'Hard Gel Extensions — Long', 9500, '$95+', 165],
  ['hard_gel_fill', 'Hard Gel Fill', 6000, '$60+', 120],
  ['hard_gel_rebalance', 'Hard Gel Rebalance', 7000, '$70+', 135],
  ['polygel_overlay', 'Polygel Overlay', 6000, '$60+', 105],
  ['polygel_full_set', 'Polygel Full Set', 7500, '$75+', 135],
  ['polygel_fill', 'Polygel Fill', 6000, '$60+', 120],
], {
  templateCategory: 'extensions',
  bookingCategory: 'manicure',
  serviceCategory: 'extensions',
  serviceType: 'base_service',
});

// ---------------------------------------------------------------------------
// Pedicure Services
// ---------------------------------------------------------------------------
const PEDICURES = expand([
  ['express_pedicure', 'Express Pedicure', 4000, null, 45],
  ['classic_pedicure', 'Classic Pedicure', 5000, null, 60, {
    description: 'Nail shaping, cuticle care, foot care and regular polish.',
    isRecommendedStarter: true,
    popularityRank: 8,
  }],
  ['gel_pedicure', 'Gel Pedicure', 5500, null, 60, {
    description: 'Nail shaping, cuticle care, foot care and gel colour.',
    isRecommendedStarter: true,
    popularityRank: 9,
    searchAliases: GEL_POLISH_ALIASES,
  }],
  ['shellac_gel_toes', 'Shellac / Gel Toes', 3000, null, 45, {
    description: 'Gel colour application for toes without a full pedicure.',
    isRecommendedStarter: true,
    popularityRank: 10,
    searchAliases: GEL_POLISH_ALIASES,
  }],
  ['russian_dry_pedicure', 'Russian / Dry Pedicure', 6000, null, 75],
  ['spa_pedicure', 'Spa Pedicure', 6500, null, 75],
  ['lavender_spa_pedicure', 'Lavender Spa Pedicure', 6500, null, 75],
  ['jelly_pedicure', 'Jelly Pedicure', 7000, null, 80],
  ['volcano_pedicure', 'Volcano Pedicure', 7500, null, 90],
  ['hot_stone_pedicure', 'Hot Stone Pedicure', 7500, null, 90],
  ['paraffin_pedicure', 'Paraffin Pedicure', 7000, null, 80],
  ['deluxe_spa_pedicure', 'Deluxe Spa Pedicure', 8000, null, 90],
  ['signature_luxury_pedicure', 'Signature Luxury Pedicure', 9000, null, 105],
  ['mens_pedicure', 'Men’s Pedicure', 5000, null, 60],
  ['kids_pedicure', 'Kids’ Pedicure', 3000, null, 40],
  ['toenail_trim_shape', 'Toenail Trim and Shape', 2500, null, 30],
  ['regular_polish_change_toes', 'Regular Polish Change — Toes', 2500, null, 30],
  ['gel_polish_change_toes', 'Gel Polish Change — Toes', 3500, null, 45, { searchAliases: GEL_POLISH_ALIASES }],
  ['french_gel_toes', 'French Gel Toes', 4500, null, 50],
  ['big_toe_extension', 'Big-Toe Extension', 1000, '$10+', 15],
  ['full_gel_toe_extensions', 'Full Gel Toe Extensions', 6000, '$60+', 90],
  ['toenail_reconstruction', 'Toenail Reconstruction', 1500, '$15+ per nail', 20],
], {
  templateCategory: 'pedicure',
  bookingCategory: 'pedicure',
  serviceCategory: 'pedicure',
  serviceType: 'base_service',
});

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------
const COMBOS = expand([
  ['classic_mani_classic_pedi_combo', 'Classic Manicure + Classic Pedicure', 7500, null, 120, {
    isRecommendedStarter: true,
    popularityRank: 11,
  }],
  ['gel_mani_gel_pedi_combo', 'Gel Manicure + Gel Pedicure', 9000, null, 135, {
    isRecommendedStarter: true,
    popularityRank: 12,
  }],
  ['classic_mani_gel_pedi_combo', 'Classic Manicure + Gel Pedicure', 8500, null, 120],
  ['gel_mani_classic_pedi_combo', 'Gel Manicure + Classic Pedicure', 8500, null, 120],
  ['biab_classic_pedi_combo', 'BIAB / Builder Gel + Classic Pedicure', 8500, null, 120, {
    isRecommendedStarter: true,
    searchAliases: BIAB_ALIASES,
  }],
  ['biab_gel_pedi_combo', 'BIAB / Builder Gel + Gel Pedicure', 10000, null, 135, {
    isRecommendedStarter: true,
    searchAliases: BIAB_ALIASES,
  }],
  ['biab_gel_colour_classic_pedi_combo', 'BIAB + Gel Colour + Classic Pedicure', 9500, null, 135, { searchAliases: BIAB_ALIASES }],
  ['biab_gel_colour_gel_pedi_combo', 'BIAB + Gel Colour + Gel Pedicure', 10500, null, 150, { searchAliases: BIAB_ALIASES }],
  ['gel_x_classic_pedi_combo', 'Gel-X + Classic Pedicure', 10500, '$105+', 155],
  ['gel_x_gel_pedi_combo', 'Gel-X + Gel Pedicure', 11500, '$115+', 165],
  ['hard_gel_classic_pedi_combo', 'Hard Gel Extensions + Classic Pedicure', 10500, '$105+', 155],
  ['hard_gel_gel_pedi_combo', 'Hard Gel Extensions + Gel Pedicure', 11500, '$115+', 165],
  ['luster_mani_classic_pedi_combo', 'Luster Manicure + Classic Pedicure', 8500, null, 120, { searchAliases: ['luster'] }],
  ['luster_mani_gel_pedi_combo', 'Luster Manicure + Gel Pedicure', 9500, null, 135, { searchAliases: ['luster'] }],
  ['kids_mani_pedi_combo', 'Kids’ Manicure + Pedicure', 4500, null, 60],
], {
  templateCategory: 'combos',
  bookingCategory: 'combo',
  serviceCategory: 'combo',
  serviceType: 'combo',
});

// ---------------------------------------------------------------------------
// Add-ons & Nail Art
// ---------------------------------------------------------------------------
const ART_COMPAT = [...STARTER_HAND_KEYS, ...STARTER_COMBO_KEYS];

const NAIL_ART_ADDONS = expand([
  ['french_tips', 'French Tips', 1000, '$10+', 15, { isRecommendedStarter: true, compatibleTemplateKeys: ART_COMPAT }],
  ['deep_french', 'Deep French', 1500, '$15+', 20],
  ['reverse_french', 'Reverse French', 1500, '$15+', 20],
  ['ombre_baby_boomer', 'Ombre / Baby Boomer', 1500, '$15+', 20],
  ['chrome', 'Chrome', 1000, null, 15, { isRecommendedStarter: true, compatibleTemplateKeys: ART_COMPAT }],
  ['cat_eye', 'Cat Eye', 1000, null, 10],
  ['magnetic_velvet_effect', 'Magnetic Velvet Effect', 1000, null, 10],
  ['simple_nail_art', 'Simple Nail Art', 1000, '$10+', 15, { isRecommendedStarter: true, compatibleTemplateKeys: ART_COMPAT }],
  ['detailed_nail_art', 'Detailed Nail Art', 2000, '$20+', 30, { isRecommendedStarter: true, compatibleTemplateKeys: ART_COMPAT }],
  ['full_nail_art_set', 'Full Nail-Art Set', 3000, '$30+', 45],
  ['hand_painted_art', 'Hand-Painted Art', 500, '$5+ per nail', 10, { pricingType: 'per_unit', unitLabel: 'nail', maxQuantity: 10 }],
  ['three_d_art_charms', '3D Art / Charms', 1500, '$15+', 20, { isRecommendedStarter: true, compatibleTemplateKeys: ART_COMPAT }],
  ['rhinestones', 'Rhinestones', 500, '$5+', 10],
  ['encapsulation', 'Encapsulation', 1000, '$10+', 20],
  ['aura_nails', 'Aura Nails', 1500, '$15+', 20],
  ['marble_design', 'Marble Design', 1500, '$15+', 20],
  ['blooming_gel_design', 'Blooming Gel Design', 1500, '$15+', 20],
  ['airbrush_design', 'Airbrush Design', 1500, '$15+', 20],
  ['stickers_decals', 'Stickers / Decals', 500, '$5+', 10],
  ['matte_top_coat', 'Matte Top Coat', 500, null, 5],
  ['glitter_finish', 'Glitter Finish', 500, '$5+', 10],
  ['multiple_colours', 'Multiple Colours', 500, '$5+', 10],
  ['medium_length', 'Medium Length', 1000, null, 10, { isRecommendedStarter: true, compatibleTemplateKeys: STARTER_EXTENSION_KEYS }],
  ['long_length', 'Long Length', 2000, null, 20, { isRecommendedStarter: true, compatibleTemplateKeys: STARTER_EXTENSION_KEYS }],
  ['extra_long_length', 'Extra-Long Length', 3000, '$30+', 30, { isRecommendedStarter: true, compatibleTemplateKeys: STARTER_EXTENSION_KEYS }],
  ['special_shape', 'Special Shape', 500, '$5+', 10, { isRecommendedStarter: true, compatibleTemplateKeys: STARTER_EXTENSION_KEYS }],
], {
  templateCategory: 'nail_art',
  bookingCategory: 'manicure',
  serviceCategory: 'manicure',
  serviceType: 'addon',
  addOnCategory: 'nail_art',
});

// ---------------------------------------------------------------------------
// Removal & Repair
// ---------------------------------------------------------------------------
const REMOVAL_REPAIR = expand([
  ['nail_repair', 'Nail Repair', 500, '$5 per nail', 10, {
    isRecommendedStarter: true,
    pricingType: 'per_unit',
    unitLabel: 'nail',
    maxQuantity: 10,
    addOnCategory: 'repair',
    compatibleTemplateKeys: STARTER_HAND_KEYS,
  }],
  ['broken_extension_replacement', 'Broken Extension Replacement', 700, '$7+ per nail', 15, {
    pricingType: 'per_unit',
    unitLabel: 'nail',
    maxQuantity: 10,
    addOnCategory: 'repair',
  }],
  ['crack_reinforcement', 'Crack Reinforcement', 500, '$5 per nail', 10, {
    pricingType: 'per_unit',
    unitLabel: 'nail',
    maxQuantity: 10,
    addOnCategory: 'repair',
  }],
  ['gel_removal', 'Gel Removal', 1000, null, 15, {
    isRecommendedStarter: true,
    addOnCategory: 'removal',
    compatibleTemplateKeys: ['gel_manicure', LUSTER_MANICURE_TEMPLATE_KEY, 'shellac_gel_toes', 'gel_pedicure'],
  }],
  ['builder_gel_removal', 'Builder Gel Removal', 2000, null, 30, {
    isRecommendedStarter: true,
    addOnCategory: 'removal',
    searchAliases: BIAB_ALIASES,
    compatibleTemplateKeys: ['builder_gel_overlay', 'builder_gel_refill'],
  }],
  ['gel_x_removal', 'Gel-X Removal', 2000, null, 30, {
    isRecommendedStarter: true,
    addOnCategory: 'removal',
    compatibleTemplateKeys: ['gel_x_extensions'],
  }],
  ['hard_gel_removal', 'Hard Gel Removal', 2500, null, 45, { addOnCategory: 'removal' }],
  ['acrylic_removal', 'Acrylic Removal', 2500, null, 45, { addOnCategory: 'removal' }],
  ['removal_from_another_salon', 'Removal From Another Salon', 1500, '$15+', 20, {
    isRecommendedStarter: true,
    addOnCategory: 'removal',
    compatibleTemplateKeys: STARTER_HAND_KEYS,
  }],
], {
  templateCategory: 'removal_repair',
  bookingCategory: 'manicure',
  serviceCategory: 'manicure',
  serviceType: 'addon',
  addOnCategory: 'removal',
});

const REMOVAL_SERVICES = expand([
  ['gel_x_removal_manicure', 'Gel-X Removal + Manicure', 4000, null, 60],
  ['builder_gel_removal_manicure', 'Builder Gel Removal + Manicure', 3500, null, 60, { searchAliases: BIAB_ALIASES }],
  ['acrylic_removal_manicure', 'Acrylic Removal + Manicure', 4000, null, 60],
], {
  templateCategory: 'removal_repair',
  bookingCategory: 'manicure',
  serviceCategory: 'manicure',
  serviceType: 'base_service',
});

// ---------------------------------------------------------------------------
// Spa Upgrades
// ---------------------------------------------------------------------------
const SPA_ADDONS = expand([
  ['sugar_scrub', 'Sugar Scrub', 1000, null, 10],
  ['paraffin_wax', 'Paraffin Wax', 1500, null, 15, {
    isRecommendedStarter: true,
    compatibleTemplateKeys: [...STARTER_PEDI_KEYS, ...STARTER_COMBO_KEYS],
  }],
  ['collagen_mask', 'Collagen Mask', 1500, null, 15],
  ['hot_towels', 'Hot Towels', 500, null, 5],
  ['callus_treatment', 'Callus Treatment', 1500, null, 15, {
    isRecommendedStarter: true,
    compatibleTemplateKeys: [...STARTER_PEDI_KEYS, ...STARTER_COMBO_KEYS],
  }],
  ['intensive_callus_treatment', 'Intensive Callus Treatment', 2500, null, 25],
  ['extended_hand_massage', 'Extended Hand Massage', 1500, null, 10],
  ['extended_foot_massage', 'Extended Foot Massage', 1500, null, 10],
  ['hot_stone_massage', 'Hot Stone Massage', 2000, null, 15],
  ['jelly_soak', 'Jelly Soak', 1500, null, 15],
], {
  templateCategory: 'spa',
  bookingCategory: 'pedicure',
  serviceCategory: 'pedicure',
  serviceType: 'addon',
  addOnCategory: 'pedicure_addon',
});

// ---------------------------------------------------------------------------
// Acrylic & Dip — "Traditional enhancement services". Available in the
// library, never seeded into starter menus.
// ---------------------------------------------------------------------------
const ACRYLIC_DIP = expand([
  ['acrylic_overlay', 'Acrylic Overlay', 5500, '$55+', 90],
  ['acrylic_full_set_short', 'Acrylic Full Set — Short', 6000, '$60+', 120, { searchAliases: TIPS_ALIASES }],
  ['acrylic_full_set_medium', 'Acrylic Full Set — Medium', 7000, '$70+', 135, { searchAliases: TIPS_ALIASES }],
  ['acrylic_full_set_long', 'Acrylic Full Set — Long', 8000, '$80+', 150, { searchAliases: TIPS_ALIASES }],
  ['acrylic_full_set_extra_long', 'Acrylic Full Set — Extra Long', 9500, '$95+', 180, { searchAliases: TIPS_ALIASES }],
  ['acrylic_fill', 'Acrylic Fill', 5000, '$50+', 105],
  ['acrylic_rebalance', 'Acrylic Rebalance', 6000, '$60+', 120],
  ['acrylic_ombre_full_set', 'Acrylic Ombre Full Set', 7500, '$75+', 150],
  ['pink_and_white_acrylic', 'Pink and White Acrylic', 8000, '$80+', 150],
  ['dip_powder_natural', 'Dip Powder on Natural Nails', 5000, null, 75],
  ['dip_powder_tips', 'Dip Powder + Tips', 6500, '$65+', 105, { searchAliases: TIPS_ALIASES }],
  ['dip_powder_french', 'Dip Powder French', 6000, null, 90],
  ['dip_powder_ombre', 'Dip Powder Ombre', 6500, null, 90],
  ['dip_powder_removal', 'Dip Powder Removal', 2000, null, 30],
  ['dip_powder_removal_new_set', 'Dip Powder Removal + New Set', 6000, null, 105],
], {
  templateCategory: 'acrylic_dip',
  bookingCategory: 'manicure',
  serviceCategory: 'manicure',
  serviceType: 'base_service',
});

export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  ...GEL_NATURAL,
  ...EXTENSIONS,
  ...PEDICURES,
  ...COMBOS,
  ...NAIL_ART_ADDONS,
  ...REMOVAL_REPAIR,
  ...REMOVAL_SERVICES,
  ...SPA_ADDONS,
  ...ACRYLIC_DIP,
];

const TEMPLATES_BY_KEY = new Map(SERVICE_TEMPLATES.map(template => [template.systemKey, template]));

export function getTemplateByKey(systemKey: string): ServiceTemplate | undefined {
  return TEMPLATES_BY_KEY.get(systemKey);
}

/** Starter-menu templates in seed order: services first (by shelf), then add-ons. */
export function getStarterTemplates(): ServiceTemplate[] {
  const starters = SERVICE_TEMPLATES.filter(template => template.isRecommendedStarter);
  return [
    ...starters.filter(template => template.serviceType !== 'addon'),
    ...starters.filter(template => template.serviceType === 'addon'),
  ];
}

export function getTemplatesByLibraryCategory(category: ServiceTemplateCategory): ServiceTemplate[] {
  if (category === 'popular') {
    return SERVICE_TEMPLATES
      .filter(template => template.popularityRank !== undefined)
      .sort((a, b) => (a.popularityRank ?? 0) - (b.popularityRank ?? 0));
  }
  return SERVICE_TEMPLATES.filter(template => template.templateCategory === category);
}

/**
 * Visible library shelves — the same three main categories the rest of the
 * app shows, plus Popular and a separate Add-ons shelf. The 9-value
 * `templateCategory` stays internal metadata (secondary card labels, search).
 */
export const LIBRARY_SHELVES = ['popular', 'manicure', 'pedicure', 'combo', 'addon'] as const;

export type LibraryShelf = (typeof LIBRARY_SHELVES)[number];

export const LIBRARY_SHELF_LABELS: Record<LibraryShelf, string> = {
  popular: 'Popular',
  manicure: 'Manicure',
  pedicure: 'Pedicure',
  combo: 'Combos',
  addon: 'Add-ons',
};

/** The shelf a template belongs to: add-ons first, else its booking category. */
export function getTemplateShelf(template: ServiceTemplate): Exclude<LibraryShelf, 'popular'> {
  if (template.serviceType === 'addon') {
    return 'addon';
  }
  return template.bookingCategory;
}

export function getTemplatesByShelf(shelf: LibraryShelf): ServiceTemplate[] {
  if (shelf === 'popular') {
    return SERVICE_TEMPLATES
      .filter(template => template.popularityRank !== undefined)
      .sort((a, b) => (a.popularityRank ?? 0) - (b.popularityRank ?? 0));
  }
  return SERVICE_TEMPLATES.filter(template => getTemplateShelf(template) === shelf);
}

function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function searchTemplates(query: string): ServiceTemplate[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }

  return SERVICE_TEMPLATES.filter((template) => {
    const haystack = [
      template.name,
      template.description ?? '',
      ...(template.searchAliases ?? []),
    ]
      .map(normalizeQuery)
      .join(' ');
    return normalized.split(' ').every(term => haystack.includes(term));
  });
}
