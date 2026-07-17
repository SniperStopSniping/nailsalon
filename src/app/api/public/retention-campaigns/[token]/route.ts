import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { hashRetentionCampaignToken } from '@/libs/retentionCampaigns';
import { retentionCampaignSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  token: z.string().min(32).max(200).regex(/^[\w-]+$/),
});

const querySchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
});

function formatOffer(discountType: 'percent' | 'fixed', value: number): string {
  return discountType === 'percent'
    ? `${value}% off`
    : `$${(value / 100).toFixed(2)} off`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const [parsedParams, parsedQuery] = await Promise.all([
    params.then(value => paramsSchema.safeParse(value)),
    Promise.resolve(querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()))),
  ]);
  if (!parsedParams.success || !parsedQuery.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'A valid campaign link and salon are required.' },
    }, { status: 400 });
  }

  const salon = await getSalonBySlug(parsedQuery.data.salonSlug);
  if (!salon) {
    return Response.json({ error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
  }

  const [campaign] = await db
    .select()
    .from(retentionCampaignSchema)
    .where(and(
      eq(retentionCampaignSchema.salonId, salon.id),
      eq(retentionCampaignSchema.tokenHash, hashRetentionCampaignToken(parsedParams.data.token)),
    ))
    .limit(1);
  if (!campaign) {
    return Response.json({ error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
  }

  if (!campaign.promotionSnapshot.enabled || campaign.expiresAt <= new Date()) {
    return Response.json({ error: { code: 'CAMPAIGN_EXPIRED', message: 'This promotion has expired.' } }, { status: 410 });
  }
  if (campaign.singleUse && campaign.redeemedAt) {
    return Response.json({ error: { code: 'CAMPAIGN_REDEEMED', message: 'This promotion has already been used.' } }, { status: 409 });
  }

  const promotion = campaign.promotionSnapshot;
  return Response.json({
    data: {
      campaign: {
        id: campaign.id,
        stage: campaign.stage,
        salonSlug: salon.slug,
        expiresAt: campaign.expiresAt.toISOString(),
        displayOffer: formatOffer(promotion.discountType, promotion.value),
        promotion: {
          name: promotion.name,
          discountType: promotion.discountType,
          value: promotion.value,
          eligibleServiceIds: promotion.eligibleServiceIds,
          code: promotion.code,
          singleUse: promotion.singleUse,
        },
      },
    },
  });
}
