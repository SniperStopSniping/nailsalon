import { z } from 'zod';

import type { SalonSettings } from '@/types/salonPolicy';

/**
 * Smart Fit discount settings, stored under `salon.settings.smartFit`.
 *
 * Smart Fit is OFF by default for every salon (existing and new). Nothing in
 * this module talks to the database or changes behavior anywhere — resolving
 * a disabled/missing/malformed config always yields the same inert default,
 * so enabling the feature is purely an explicit owner action (P7.2 settings
 * surface; approved P6 architecture in docs/luster-implementation-handoff.md).
 *
 * Only the settings approved by the P6 plan exist here. Deliberately absent
 * (dropped as unnecessary by the approved architecture): before/after/between
 * adjacency toggles, promotion-stacking controls, and a suggestion-distance
 * setting (a UI-phase code constant, not owner configuration).
 */

export const SMART_FIT_DISCOUNT_TYPES = ['percent', 'fixed'] as const;
export type SmartFitDiscountType = (typeof SMART_FIT_DISCOUNT_TYPES)[number];

/** Approved clamp limits for numeric settings. */
export const SMART_FIT_LIMITS = {
  percentMax: 100,
  /** Fixed discounts are cents; mirrors the payments amount ceiling. */
  fixedCentsMax: 5_000_000,
  maxRemainingGapMinutesMax: 60,
  minImprovementMinutesMax: 240,
} as const;

export const salonSmartFitSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  /** 'percent' → value is a whole percentage; 'fixed' → value is cents. */
  discountType: z.enum(SMART_FIT_DISCOUNT_TYPES).optional(),
  value: z.number().optional(),
  /** Largest gap (minutes) left beside the neighboring block that still counts as "tight". */
  maxRemainingGapMinutes: z.number().optional(),
  /** Minimum free-span slack (minutes) required before a fit counts as an improvement. */
  minImprovementMinutes: z.number().optional(),
  /** Empty array = every service is eligible. */
  eligibleServiceIds: z.array(z.string()).optional(),
  /** Empty array = every technician is eligible. */
  eligibleTechnicianIds: z.array(z.string()).optional(),
});

export type SalonSmartFitSettings = z.infer<typeof salonSmartFitSettingsSchema>;

export type ResolvedSmartFitConfig = {
  enabled: boolean;
  discountType: SmartFitDiscountType;
  /** Whole percent (percent mode) or cents (fixed mode); already clamped. */
  value: number;
  maxRemainingGapMinutes: number;
  minImprovementMinutes: number;
  eligibleServiceIds: string[];
  eligibleTechnicianIds: string[];
};

export const DISABLED_SMART_FIT_CONFIG: ResolvedSmartFitConfig = {
  enabled: false,
  discountType: 'percent',
  value: 10,
  maxRemainingGapMinutes: 10,
  minImprovementMinutes: 20,
  eligibleServiceIds: [],
  eligibleTechnicianIds: [],
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Read the stored Smart Fit settings for editing surfaces. Malformed legacy
 * shapes collapse to `{}` (off) rather than erroring.
 */
export function readStoredSmartFitSettings(
  settings: SalonSettings | null | undefined,
): SalonSmartFitSettings {
  const parsed = salonSmartFitSettingsSchema.safeParse(settings?.smartFit ?? {});
  return parsed.success ? parsed.data : {};
}

/**
 * Resolve the effective Smart Fit configuration from `salon.settings`.
 *
 * Never throws: a missing, null, or malformed `smartFit` namespace (including
 * wrong-typed fields, which fail the whole safeParse) resolves to the inert
 * disabled default. Unknown fields are ignored (zod strips them). Numeric
 * values are truncated to integers and clamped to SMART_FIT_LIMITS so a
 * mis-edited blob can widen or shrink behavior only within approved bounds.
 */
export function resolveSmartFitConfig(
  settings: SalonSettings | null | undefined,
): ResolvedSmartFitConfig {
  const parsed = salonSmartFitSettingsSchema.safeParse(settings?.smartFit ?? {});
  if (!parsed.success) {
    return DISABLED_SMART_FIT_CONFIG;
  }
  const stored = parsed.data;
  if (!stored.enabled) {
    return DISABLED_SMART_FIT_CONFIG;
  }

  const discountType: SmartFitDiscountType = stored.discountType ?? 'percent';
  const valueMax = discountType === 'percent'
    ? SMART_FIT_LIMITS.percentMax
    : SMART_FIT_LIMITS.fixedCentsMax;

  return {
    enabled: true,
    discountType,
    value: clampInt(stored.value, DISABLED_SMART_FIT_CONFIG.value, 0, valueMax),
    maxRemainingGapMinutes: clampInt(
      stored.maxRemainingGapMinutes,
      DISABLED_SMART_FIT_CONFIG.maxRemainingGapMinutes,
      0,
      SMART_FIT_LIMITS.maxRemainingGapMinutesMax,
    ),
    minImprovementMinutes: clampInt(
      stored.minImprovementMinutes,
      DISABLED_SMART_FIT_CONFIG.minImprovementMinutes,
      0,
      SMART_FIT_LIMITS.minImprovementMinutesMax,
    ),
    eligibleServiceIds: (stored.eligibleServiceIds ?? []).filter(id => id.length > 0),
    eligibleTechnicianIds: (stored.eligibleTechnicianIds ?? []).filter(id => id.length > 0),
  };
}
