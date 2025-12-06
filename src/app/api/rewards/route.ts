/**
 * Rewards API Route
 *
 * Get all rewards for a client.
 *
 * GET /api/rewards?phone=1234567890&salonSlug=nail-salon-no5
 */

import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { rewardSchema, type Reward } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getRewardsSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface RewardWithExpiry extends Reward {
  isExpired: boolean;
  daysUntilExpiry: number | null;
}

interface SuccessResponse {
  data: {
    rewards: RewardWithExpiry[];
  };
  meta: {
    timestamp: string;
    count: number;
    activeCount: number;
    totalPoints: number;
    activePoints: number;
  };
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// =============================================================================
// GET /api/rewards - Get rewards for a client
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    // 1. Parse query parameters
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    const salonSlug = searchParams.get('salonSlug');

    // 2. Validate parameters
    const parsed = getRewardsSchema.safeParse({ phone, salonSlug });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      let userMessage = 'Invalid request parameters';

      if (fieldErrors.phone) {
        userMessage = 'Your phone number is invalid.';
      } else if (fieldErrors.salonSlug) {
        userMessage = 'Unable to identify salon.';
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

    // 4. Fetch rewards for this phone and salon
    const rewards = await db
      .select()
      .from(rewardSchema)
      .where(
        and(
          eq(rewardSchema.salonId, salon.id),
          eq(rewardSchema.clientPhone, parsed.data.phone),
        ),
      )
      .orderBy(desc(rewardSchema.createdAt));

    // 5. Enrich rewards with expiry info and auto-expire if needed
    const now = new Date();
    const enrichedRewards: RewardWithExpiry[] = [];
    const rewardsToExpire: string[] = [];

    for (const reward of rewards) {
      let isExpired = reward.status === 'expired';
      let daysUntilExpiry: number | null = null;

      if (reward.expiresAt && reward.status === 'active') {
        const expiresAt = new Date(reward.expiresAt);
        if (now > expiresAt) {
          isExpired = true;
          rewardsToExpire.push(reward.id);
        } else {
          const diffTime = expiresAt.getTime() - now.getTime();
          daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
      }

      enrichedRewards.push({
        ...reward,
        status: isExpired && reward.status === 'active' ? 'expired' : reward.status,
        isExpired,
        daysUntilExpiry,
      });
    }

    // 6. Mark expired rewards in database (fire and forget)
    if (rewardsToExpire.length > 0) {
      // Update expired rewards in background
      Promise.all(
        rewardsToExpire.map(id =>
          db.update(rewardSchema)
            .set({ status: 'expired' })
            .where(eq(rewardSchema.id, id)),
        ),
      ).catch(err => console.error('Error updating expired rewards:', err));
    }

    // 7. Calculate counts and points totals
    const activeRewards = enrichedRewards.filter(r => r.status === 'active' && !r.isExpired);
    const activeCount = activeRewards.length;
    const totalPoints = enrichedRewards.reduce((sum, r) => sum + (r.points || 0), 0);
    const activePoints = activeRewards.reduce((sum, r) => sum + (r.points || 0), 0);

    // 8. Return response
    const response: SuccessResponse = {
      data: {
        rewards: enrichedRewards,
      },
      meta: {
        timestamp: new Date().toISOString(),
        count: enrichedRewards.length,
        activeCount,
        totalPoints,
        activePoints,
      },
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching rewards:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while fetching rewards',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
