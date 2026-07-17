import { createHash, randomBytes } from 'node:crypto';

import type { RetentionPromotionSettings } from '@/types/retention';

export const RETENTION_CAMPAIGN_TOKEN_BYTES = 32;

export function createRetentionCampaignToken(): string {
  return randomBytes(RETENTION_CAMPAIGN_TOKEN_BYTES).toString('base64url');
}

/** Only the hash is persisted so a database read cannot expose live links. */
export function hashRetentionCampaignToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type CampaignValidationFailureCode =
  | 'CAMPAIGN_EXPIRED'
  | 'CAMPAIGN_REDEEMED'
  | 'CLIENT_MISMATCH'
  | 'NO_ELIGIBLE_SERVICE'
  | 'PROMOTION_DISABLED';

export type CampaignValidationResult =
  | { valid: true }
  | { valid: false; code: CampaignValidationFailureCode };

export function validateRetentionCampaign(args: {
  promotion: RetentionPromotionSettings;
  expiresAt: Date;
  redeemedAt: Date | null;
  singleUse: boolean;
  campaignClientId: string;
  bookingClientId: string;
  serviceIds: string[];
  now?: Date;
}): CampaignValidationResult {
  const now = args.now ?? new Date();
  if (!args.promotion.enabled) {
    return { valid: false, code: 'PROMOTION_DISABLED' };
  }
  if (args.expiresAt <= now) {
    return { valid: false, code: 'CAMPAIGN_EXPIRED' };
  }
  if (args.singleUse && args.redeemedAt) {
    return { valid: false, code: 'CAMPAIGN_REDEEMED' };
  }
  if (args.campaignClientId !== args.bookingClientId) {
    return { valid: false, code: 'CLIENT_MISMATCH' };
  }
  if (
    args.promotion.eligibleServiceIds.length > 0
    && !args.serviceIds.some(serviceId => args.promotion.eligibleServiceIds.includes(serviceId))
  ) {
    return { valid: false, code: 'NO_ELIGIBLE_SERVICE' };
  }
  return { valid: true };
}

export function calculateRetentionDiscount(args: {
  promotion: RetentionPromotionSettings;
  services: Array<{ id: string; priceCents: number }>;
}): { eligibleSubtotalCents: number; discountAmountCents: number } {
  const eligibleServices = args.promotion.eligibleServiceIds.length === 0
    ? args.services
    : args.services.filter(service => args.promotion.eligibleServiceIds.includes(service.id));
  const eligibleSubtotalCents = eligibleServices.reduce(
    (total, service) => total + Math.max(0, service.priceCents),
    0,
  );

  if (!args.promotion.enabled || args.promotion.value <= 0 || eligibleSubtotalCents <= 0) {
    return { eligibleSubtotalCents, discountAmountCents: 0 };
  }

  const requestedDiscount = args.promotion.discountType === 'percent'
    ? Math.floor(eligibleSubtotalCents * Math.min(args.promotion.value, 100) / 100)
    : args.promotion.value;

  return {
    eligibleSubtotalCents,
    discountAmountCents: Math.min(eligibleSubtotalCents, Math.max(0, requestedDiscount)),
  };
}

export function getCampaignExpiry(now: Date, expiryDays: number): Date {
  return new Date(now.getTime() + expiryDays * 86_400_000);
}
