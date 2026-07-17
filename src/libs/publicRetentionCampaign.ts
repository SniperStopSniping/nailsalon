import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  calculateRetentionDiscount,
  hashRetentionCampaignToken,
  validateRetentionCampaign,
} from '@/libs/retentionCampaigns';
import { retentionCampaignSchema } from '@/models/Schema';

const CAMPAIGN_TOKEN_PATTERN = /^[\w-]{32,200}$/;

export type PublicRetentionCampaignPreview = {
  id: string;
  stage: 'promo_6w' | 'promo_8w';
  name: string;
  displayOffer: string;
  code: string | null;
  expiresAt: string;
  discountAmountCents: number;
};

export type PublicRetentionCampaignResolution =
  | { status: 'none'; preview: null; message: null }
  | { status: 'invalid'; preview: null; message: string }
  | { status: 'valid'; preview: PublicRetentionCampaignPreview; message: null };

export function formatRetentionCampaignOffer(
  discountType: 'percent' | 'fixed',
  value: number,
): string {
  return discountType === 'percent'
    ? `${value}% off`
    : `$${(value / 100).toFixed(2)} off`;
}

export async function resolvePublicRetentionCampaignPreview(args: {
  token?: string | null;
  salonId: string;
  services: Array<{ id: string; priceCents: number }>;
  now?: Date;
}): Promise<PublicRetentionCampaignResolution> {
  if (!args.token) {
    return { status: 'none', preview: null, message: null };
  }
  if (!CAMPAIGN_TOKEN_PATTERN.test(args.token)) {
    return {
      status: 'invalid',
      preview: null,
      message: 'This promotion link is not valid. Ask the salon for a new link.',
    };
  }

  const [campaign] = await db
    .select()
    .from(retentionCampaignSchema)
    .where(and(
      eq(retentionCampaignSchema.salonId, args.salonId),
      eq(retentionCampaignSchema.tokenHash, hashRetentionCampaignToken(args.token)),
    ))
    .limit(1);

  if (!campaign) {
    return {
      status: 'invalid',
      preview: null,
      message: 'This promotion link was not found for this salon.',
    };
  }

  const serviceIds = args.services.map(service => service.id);
  const validation = validateRetentionCampaign({
    promotion: campaign.promotionSnapshot,
    expiresAt: campaign.expiresAt,
    redeemedAt: campaign.redeemedAt,
    singleUse: campaign.singleUse,
    // Client identity is checked during the authenticated booking write, once
    // the guest has supplied their phone number. This server preview only
    // exposes the snapshotted offer and selected-service eligibility.
    campaignClientId: campaign.salonClientId,
    bookingClientId: campaign.salonClientId,
    serviceIds,
    now: args.now,
  });

  if (!validation.valid) {
    const message = validation.code === 'CAMPAIGN_REDEEMED'
      ? 'This promotion has already been used.'
      : validation.code === 'NO_ELIGIBLE_SERVICE'
        ? 'This promotion does not apply to the selected service.'
        : 'This promotion is no longer available.';
    return { status: 'invalid', preview: null, message };
  }

  const { discountAmountCents } = calculateRetentionDiscount({
    promotion: campaign.promotionSnapshot,
    services: args.services,
  });
  if (discountAmountCents <= 0) {
    return {
      status: 'invalid',
      preview: null,
      message: 'This promotion does not apply to the selected service.',
    };
  }

  return {
    status: 'valid',
    preview: {
      id: campaign.id,
      stage: campaign.stage as 'promo_6w' | 'promo_8w',
      name: campaign.promotionSnapshot.name,
      displayOffer: formatRetentionCampaignOffer(
        campaign.promotionSnapshot.discountType,
        campaign.promotionSnapshot.value,
      ),
      code: campaign.promotionSnapshot.code,
      expiresAt: campaign.expiresAt.toISOString(),
      discountAmountCents,
    },
    message: null,
  };
}
