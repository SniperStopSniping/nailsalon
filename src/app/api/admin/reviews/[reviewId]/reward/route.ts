import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { GOOGLE_REVIEW_REWARD_AMOUNT_CENTS, getRewardDisplayContent } from '@/libs/rewardRules';
import { reviewSchema, rewardSchema, salonClientSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const grantReviewRewardSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
): Promise<Response> {
  try {
    const { reviewId } = await params;
    const body = await request.json();
    const parsed = grantReviewRewardSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug } = parsed.data;
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    const rewardsGuard = await guardModuleOr403({ salonId: salon.id, module: 'rewards' });
    if (rewardsGuard) {
      return rewardsGuard;
    }

    if (salon.rewardsEnabled === false || salon.reviewsEnabled === false) {
      return Response.json(
        {
          error: {
            code: 'FEATURE_DISABLED',
            message: 'Reviews and rewards must both be enabled to grant this reward',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    const [review] = await db
      .select({
        id: reviewSchema.id,
        salonId: reviewSchema.salonId,
        salonClientId: reviewSchema.salonClientId,
        clientNameSnapshot: reviewSchema.clientNameSnapshot,
        clientPhone: salonClientSchema.phone,
        clientName: salonClientSchema.fullName,
      })
      .from(reviewSchema)
      .innerJoin(salonClientSchema, eq(reviewSchema.salonClientId, salonClientSchema.id))
      .where(
        and(
          eq(reviewSchema.id, reviewId),
          eq(reviewSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!review) {
      return Response.json(
        {
          error: {
            code: 'REVIEW_NOT_FOUND',
            message: 'Review not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    const clientPhone = review.clientPhone?.replace(/\D/g, '').slice(-10);
    if (!clientPhone) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_PHONE_MISSING',
            message: 'The client on this review does not have a usable phone number',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const existingReward = await db
      .select({ id: rewardSchema.id })
      .from(rewardSchema)
      .where(
        and(
          eq(rewardSchema.salonId, salon.id),
          eq(rewardSchema.clientPhone, clientPhone),
          eq(rewardSchema.type, 'google_review'),
        ),
      )
      .limit(1);

    if (existingReward.length > 0) {
      return Response.json(
        {
          error: {
            code: 'REWARD_ALREADY_GRANTED',
            message: 'This client has already received the Google review reward',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    const rewardId = `reward_${crypto.randomUUID()}`;
    await db.insert(rewardSchema).values({
      id: rewardId,
      salonId: salon.id,
      clientPhone,
      clientName: review.clientName ?? review.clientNameSnapshot,
      type: 'google_review',
      points: 0,
      discountType: 'fixed_amount',
      discountAmountCents: GOOGLE_REVIEW_REWARD_AMOUNT_CENTS,
      eligibleServiceName: null,
      status: 'active',
    });

    return Response.json({
      data: {
        rewardId,
        reviewId: review.id,
        clientPhone,
        reward: getRewardDisplayContent({
          type: 'google_review',
          discountType: 'fixed_amount',
          discountAmountCents: GOOGLE_REVIEW_REWARD_AMOUNT_CENTS,
        }),
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error granting Google review reward:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to grant Google review reward',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
