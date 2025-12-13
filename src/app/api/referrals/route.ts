import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { type Referral, referralSchema, type ReferralStatus, rewardSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getReferralsSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

// Enriched referral with additional info for the UI
type EnrichedReferral = {
  // Reward info
  hasReferrerReward: boolean;
  // Days until expiry for claimed referrals
  daysUntilExpiry: number | null;
  isExpired: boolean;
} & Referral;

type SuccessResponse = {
  data: {
    referrals: EnrichedReferral[];
  };
  meta: {
    timestamp: string;
    count: number;
    rewardedCount: number;
    pendingCount: number;
  };
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

// =============================================================================
// GET /api/referrals - Get referrals sent by a phone number
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    // 1. Parse query parameters
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    const salonSlug = searchParams.get('salonSlug');

    // 2. Validate parameters
    const parsed = getReferralsSchema.safeParse({ phone, salonSlug });

    if (!parsed.success) {
      // Create a user-friendly error message based on which field failed
      const fieldErrors = parsed.error.flatten().fieldErrors;
      let userMessage = 'Invalid request parameters';

      if (fieldErrors.phone) {
        userMessage = 'Your phone number is invalid. Please book an appointment first.';
      } else if (fieldErrors.salonSlug) {
        userMessage = 'Unable to identify salon. Please refresh and try again.';
      }

      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: userMessage,
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 3. Resolve salon from slug
    const salon = await getSalonBySlug(parsed.data.salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: `Salon with slug "${parsed.data.salonSlug}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 4. Fetch referrals for this phone number and salon
    const referrals = await db
      .select()
      .from(referralSchema)
      .where(
        and(
          eq(referralSchema.salonId, salon.id),
          eq(referralSchema.referrerPhone, parsed.data.phone),
        ),
      )
      .orderBy(desc(referralSchema.createdAt));

    // 5. Check for referrer rewards associated with these referrals
    const referralIds = referrals.map(r => r.id);
    const referrerRewards = referralIds.length > 0
      ? await db
        .select({ referralId: rewardSchema.referralId })
        .from(rewardSchema)
        .where(
          and(
            eq(rewardSchema.clientPhone, parsed.data.phone),
            eq(rewardSchema.type, 'referral_referrer'),
          ),
        )
      : [];

    const referralIdsWithReward = new Set(
      referrerRewards.map(r => r.referralId).filter(Boolean),
    );

    // 6. Enrich referrals with expiry info and reward status
    const now = new Date();
    const enrichedReferrals: EnrichedReferral[] = [];
    const referralsToExpire: string[] = [];

    for (const referral of referrals) {
      let isExpired = referral.status === 'expired';
      let daysUntilExpiry: number | null = null;
      let currentStatus: ReferralStatus = referral.status as ReferralStatus;

      // Check if claimed referral has expired (14-day window)
      if (referral.expiresAt && ['claimed', 'booked'].includes(referral.status)) {
        const expiresAt = new Date(referral.expiresAt);
        if (now > expiresAt) {
          isExpired = true;
          currentStatus = 'expired';
          referralsToExpire.push(referral.id);
        } else {
          const diffTime = expiresAt.getTime() - now.getTime();
          daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
      }

      enrichedReferrals.push({
        ...referral,
        status: currentStatus,
        hasReferrerReward: referralIdsWithReward.has(referral.id),
        daysUntilExpiry,
        isExpired,
      });
    }

    // 7. Mark expired referrals in database (fire and forget)
    if (referralsToExpire.length > 0) {
      Promise.all(
        referralsToExpire.map(id =>
          db.update(referralSchema)
            .set({ status: 'expired' })
            .where(eq(referralSchema.id, id)),
        ),
      ).catch(err => console.error('Error updating expired referrals:', err));
    }

    // 8. Calculate counts
    const rewardedCount = enrichedReferrals.filter(r => r.status === 'reward_earned').length;
    const pendingCount = enrichedReferrals.filter(r => ['sent', 'claimed', 'booked'].includes(r.status)).length;

    // 9. Return response
    const response: SuccessResponse = {
      data: {
        referrals: enrichedReferrals,
      },
      meta: {
        timestamp: new Date().toISOString(),
        count: enrichedReferrals.length,
        rewardedCount,
        pendingCount,
      },
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching referrals:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while fetching referrals',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
