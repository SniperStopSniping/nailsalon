import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { resolveNextVisitOfferPreview } from '@/libs/nextVisitOffer.server';
import { getSalonBySlug } from '@/libs/queries';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
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
  props: { params: Promise<{ token: string } | Promise<{ token: string }>> },
): Promise<Response> {
  const params = await props.params;
  // Public, unauthenticated endpoint: throttle per IP before any DB work.
  // A legitimate client opens a campaign link at most a few times.
  const rateLimit = checkEndpointRateLimit('public/retention-campaigns', getClientIp(request), 'REFERRAL');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfterMs);
  }

  const [parsedParams, parsedQuery] = await Promise.all([
    Promise.resolve(params).then(value => paramsSchema.safeParse(value)),
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

  if (campaign.stage === 'next_visit') {
    // Service selection has no authenticated contact, chosen service, or
    // appointment date yet. The offer resolver still verifies the opaque
    // capability, tenant, entitlement state and deadline. A no-service result
    // is the expected available discovery state; final service/date/client
    // eligibility is revalidated by the normal booking path.
    const offer = await resolveNextVisitOfferPreview({
      salonId: salon.id,
      token: parsedParams.data.token,
      services: [],
    });
    if (!offer) {
      return Response.json({ error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
    }
    if (offer.reason === 'ALREADY_USED') {
      return Response.json({ error: { code: 'CAMPAIGN_REDEEMED', message: 'This Next Visit Offer has already been used.' } }, { status: 409 });
    }
    if (offer.reason === 'EXPIRED') {
      return Response.json({ error: { code: 'CAMPAIGN_EXPIRED', message: 'This Next Visit Offer has expired.' } }, { status: 410 });
    }
    if (offer.status !== 'eligible' && offer.reason !== 'NO_ELIGIBLE_SERVICE') {
      return Response.json({ error: { code: 'CAMPAIGN_EXPIRED', message: 'This Next Visit Offer is no longer available.' } }, { status: 410 });
    }

    return Response.json({
      data: {
        campaign: {
          id: campaign.id,
          stage: 'next_visit',
          salonSlug: salon.slug,
          expiresAt: campaign.expiresAt.toISOString(),
          deadlineDate: offer.deadlineDate,
          displayOffer: formatOffer(offer.promotion.discountType, offer.promotion.value),
          promotion: {
            name: offer.label,
            discountType: offer.promotion.discountType,
            value: offer.promotion.value,
            eligibleServiceIds: offer.promotion.eligibleServiceIds,
            code: null,
            singleUse: true,
          },
        },
      },
    });
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
