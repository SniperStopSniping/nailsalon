import { z } from 'zod';

import { calculateRetentionDiscount } from '@/libs/retentionCampaigns';
import { getDateKeyInTimeZone, zonedTimeToUtc } from '@/libs/timeZone';
import type { RetentionPromotionSettings } from '@/types/retention';

import { DEFAULT_NEXT_VISIT_OFFER_SETTINGS, type NextVisitOfferSettings } from './nextVisitOfferSettings';

export { DEFAULT_NEXT_VISIT_OFFER_SETTINGS, NEXT_VISIT_OFFER_WINDOW_PRESETS, type NextVisitOfferSettings } from './nextVisitOfferSettings';

export const nextVisitOfferSettingsSchema = z.object({
  enabled: z.boolean(),
  windowDays: z.number().int().min(1).max(90),
  discountType: z.enum(['percent', 'fixed']),
  value: z.number().int().positive().max(1_000_000),
  eligibleServiceIds: z.array(z.string().trim().min(1).max(200)).max(200)
    .refine(ids => new Set(ids).size === ids.length, 'Eligible service ids must be unique'),
  messageTemplate: z.string().trim().max(1000),
}).strict().superRefine((value, context) => {
  if (value.discountType === 'percent' && value.value > 100) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: 100,
      type: 'number',
      inclusive: true,
      path: ['value'],
      message: 'Percentage discounts cannot exceed 100%',
    });
  }
});

export type NextVisitOfferEligibilityReason =
  | 'ELIGIBLE'
  | 'OFFER_DISABLED'
  | 'INVALID_SETTINGS'
  | 'SOURCE_NOT_COMPLETED'
  | 'SOURCE_DELETED'
  | 'SOURCE_NO_VALUE'
  | 'SOURCE_BEFORE_ENABLED'
  | 'EXPIRED'
  | 'NEXT_APPOINTMENT_NOT_AFTER_SOURCE'
  | 'NEXT_APPOINTMENT_OUTSIDE_WINDOW'
  | 'NO_ELIGIBLE_SERVICE';

export type NextVisitOfferEligibility = {
  eligible: boolean;
  reason: NextVisitOfferEligibilityReason;
  deadlineDate: string | null;
  expiresAt: Date | null;
  eligibleSubtotalCents: number;
  discountAmountCents: number;
};

function addCalendarDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return [
    result.getUTCFullYear(),
    String(result.getUTCMonth() + 1).padStart(2, '0'),
    String(result.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * The deadline is a salon-local calendar day. Its expiry is the start of the
 * following salon-local day, so daylight-saving changes do not alter eligibility.
 */
export function getNextVisitOfferDeadline(args: {
  completedAt: Date;
  windowDays: number;
  timeZone: string;
}): { deadlineDate: string; expiresAt: Date } {
  const completedDate = getDateKeyInTimeZone(args.completedAt, args.timeZone);
  const deadlineDate = addCalendarDays(completedDate, args.windowDays);
  const nextDate = addCalendarDays(deadlineDate, 1);

  return {
    deadlineDate,
    expiresAt: zonedTimeToUtc({ date: nextDate, time: '00:00', timeZone: args.timeZone }),
  };
}

/** Safely reads an optional stored settings blob without enabling a legacy salon. */
export function resolveNextVisitOfferSettings(value: unknown): NextVisitOfferSettings {
  const parsed = nextVisitOfferSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_NEXT_VISIT_OFFER_SETTINGS;
}

export function toNextVisitRetentionPromotion(
  settings: NextVisitOfferSettings,
): RetentionPromotionSettings {
  return {
    enabled: settings.enabled,
    name: 'Next visit offer',
    discountType: settings.discountType,
    value: settings.value,
    eligibleServiceIds: settings.eligibleServiceIds,
    expiryDays: settings.windowDays,
    code: null,
    messageTemplate: settings.messageTemplate,
    singleUse: true,
  };
}

export function calculateNextVisitOfferDiscount(args: {
  settings: NextVisitOfferSettings;
  /** Base services only. Add-ons are deliberately excluded from this input. */
  services: Array<{ id: string; priceCents: number }>;
}): { eligibleSubtotalCents: number; discountAmountCents: number } {
  return calculateRetentionDiscount({
    promotion: toNextVisitRetentionPromotion(args.settings),
    services: args.services,
  });
}

export function evaluateNextVisitOfferEligibility(args: {
  settings: NextVisitOfferSettings;
  source: {
    status: string;
    completedAt: Date | null;
    deletedAt: Date | null;
    finalPriceCents: number;
  };
  nextAppointmentStart: Date;
  services: Array<{ id: string; priceCents: number }>;
  timeZone: string;
  now?: Date;
  /** An offer never retroactively qualifies appointments completed before activation. */
  enabledAt?: Date | null;
}): NextVisitOfferEligibility {
  const invalid = nextVisitOfferSettingsSchema.safeParse(args.settings);
  if (!invalid.success) {
    return unavailable('INVALID_SETTINGS');
  }
  if (!args.settings.enabled) {
    return unavailable('OFFER_DISABLED');
  }
  if (args.source.status !== 'completed' || !args.source.completedAt) {
    return unavailable('SOURCE_NOT_COMPLETED');
  }
  if (args.source.deletedAt) {
    return unavailable('SOURCE_DELETED');
  }
  if (args.source.finalPriceCents <= 0) {
    return unavailable('SOURCE_NO_VALUE');
  }
  if (args.enabledAt && args.source.completedAt < args.enabledAt) {
    return unavailable('SOURCE_BEFORE_ENABLED');
  }

  const { deadlineDate, expiresAt } = getNextVisitOfferDeadline({
    completedAt: args.source.completedAt,
    windowDays: args.settings.windowDays,
    timeZone: args.timeZone,
  });
  const now = args.now ?? new Date();
  if (now >= expiresAt) {
    return unavailable('EXPIRED', deadlineDate, expiresAt);
  }
  if (args.nextAppointmentStart <= args.source.completedAt) {
    return unavailable('NEXT_APPOINTMENT_NOT_AFTER_SOURCE', deadlineDate, expiresAt);
  }
  if (getDateKeyInTimeZone(args.nextAppointmentStart, args.timeZone) > deadlineDate) {
    return unavailable('NEXT_APPOINTMENT_OUTSIDE_WINDOW', deadlineDate, expiresAt);
  }

  const discount = calculateNextVisitOfferDiscount({ settings: args.settings, services: args.services });
  if (discount.eligibleSubtotalCents <= 0 || discount.discountAmountCents <= 0) {
    return { eligible: false, reason: 'NO_ELIGIBLE_SERVICE', deadlineDate, expiresAt, ...discount };
  }
  return { eligible: true, reason: 'ELIGIBLE', deadlineDate, expiresAt, ...discount };
}

function unavailable(
  reason: Exclude<NextVisitOfferEligibilityReason, 'ELIGIBLE' | 'NO_ELIGIBLE_SERVICE'>,
  deadlineDate: string | null = null,
  expiresAt: Date | null = null,
): NextVisitOfferEligibility {
  return {
    eligible: false,
    reason,
    deadlineDate,
    expiresAt,
    eligibleSubtotalCents: 0,
    discountAmountCents: 0,
  };
}

/** Existing promotion wins ties so adding this feature never creates stacking. */
export function chooseNextVisitOrExistingDiscount(args: {
  nextVisitDiscountCents: number;
  existingDiscountCents: number;
}): { source: 'next_visit' | 'existing'; discountAmountCents: number } {
  if (args.nextVisitDiscountCents > args.existingDiscountCents) {
    return { source: 'next_visit', discountAmountCents: args.nextVisitDiscountCents };
  }
  return { source: 'existing', discountAmountCents: Math.max(0, args.existingDiscountCents) };
}

/** Safe operational feedback; never expose raw SQL or tenant identifiers. */
export function nextVisitMutationFailure(error: unknown): { code: string; message: string } | null {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === 'NEXT_VISIT_OFFER_CHANGED' || (candidate.code === '23514' && typeof candidate.message === 'string' && candidate.message.includes('NEXT_VISIT_OFFER_CHANGED:'))) {
      return { code: 'NEXT_VISIT_OFFER_CHANGED', message: 'This visit is linked to a Next Visit Offer. Review the offer and current price before continuing. A cancelled discounted visit must be rebooked.' };
    }
    if (candidate.code === '55P03') {
      return { code: 'APPOINTMENT_BUSY', message: 'This appointment or client is being updated. Refresh and try again.' };
    }
    current = candidate.cause;
  }
  return null;
}
