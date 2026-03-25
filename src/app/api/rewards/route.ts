/**
 * Rewards API Route
 *
 * Get all rewards for a client.
 *
 * GET /api/rewards?phone=1234567890&salonSlug=nail-salon-no5
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireClientApiSession,
  requireClientSalonFromQuery,
} from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import { appointmentSchema, type Reward, rewardSchema, salonClientSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getRewardsSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type RewardWithExpiry = {
  isExpired: boolean;
  daysUntilExpiry: number | null;
} & Reward;

type SuccessResponse = {
  data: {
    rewards: RewardWithExpiry[];
  };
  meta: {
    timestamp: string;
    count: number;
    activeCount: number;
    totalPoints: number;
    activePoints: number; // The client's actual loyalty points balance
    pendingPoints: number;
    pendingAppointments: number;
    totalVisits?: number;
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
// GET /api/rewards - Get rewards for a client
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireClientApiSession();
    if (!auth.ok) {
      return auth.response;
    }

    // 1. Parse query parameters
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    // 2. Validate parameters
    const parsed = getRewardsSchema.safeParse({ salonSlug });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      let userMessage = 'Invalid request parameters';

      if (fieldErrors.salonSlug) {
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

    // 3. Resolve salon from slug or active tenant cookie
    const salonGuard = await requireClientSalonFromQuery(searchParams);
    if (!salonGuard.ok) {
      return salonGuard.response;
    }
    const { salon } = salonGuard;

    // 4. Fetch the client's loyalty points balance from salonClient
    // Try multiple phone formats
    const phoneVariants = [...new Set([
      auth.normalizedPhone,
      auth.session.phone,
      `+1${auth.normalizedPhone}`,
      `1${auth.normalizedPhone}`,
      auth.session.phone.replace(/\D/g, ''),
    ])];

    const salonClients = await db
      .select({
        loyaltyPoints: salonClientSchema.loyaltyPoints,
        totalVisits: salonClientSchema.totalVisits,
      })
      .from(salonClientSchema)
      .where(
        and(
          eq(salonClientSchema.salonId, salon.id),
          inArray(salonClientSchema.phone, phoneVariants),
        ),
      )
      .limit(1);

    const clientLoyaltyPoints = salonClients[0]?.loyaltyPoints ?? 0;
    const totalVisits = salonClients[0]?.totalVisits ?? 0;

    const pendingStats = await db
      .select({
        pendingTotalCents: sql<number>`COALESCE(sum(${appointmentSchema.totalPrice}), 0)::int`,
        pendingAppointments: sql<number>`count(*)::int`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
          inArray(appointmentSchema.status, ['pending', 'confirmed', 'in_progress']),
        ),
      );

    const pendingTotalCents = pendingStats[0]?.pendingTotalCents ?? 0;
    const pendingPoints = computeEarnedPointsFromCents(pendingTotalCents);
    const pendingAppointments = pendingStats[0]?.pendingAppointments ?? 0;

    // 5. Fetch rewards for this phone and salon
    const rewards = await db
      .select()
      .from(rewardSchema)
      .where(
        and(
          eq(rewardSchema.salonId, salon.id),
          eq(rewardSchema.clientPhone, auth.normalizedPhone),
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

    // 8. Calculate counts
    // Active rewards = rewards that can still be redeemed (not linked to an appointment yet)
    const activeRewards = enrichedRewards.filter(r =>
      r.status === 'active' && !r.isExpired && !r.usedInAppointmentId,
    );
    const activeCount = activeRewards.length;

    // Points from rewards (for reference, but clientLoyaltyPoints is the real balance)
    const rewardPoints = enrichedRewards.reduce((sum, r) => sum + (r.points || 0), 0);

    // 9. Return response
    // Use clientLoyaltyPoints as the actual points balance (from salonClient table)
    const response: SuccessResponse = {
      data: {
        rewards: enrichedRewards,
      },
      meta: {
        timestamp: new Date().toISOString(),
        count: enrichedRewards.length,
        activeCount,
        totalPoints: rewardPoints,
        activePoints: clientLoyaltyPoints, // This is the real points balance!
        pendingPoints,
        pendingAppointments,
        totalVisits,
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
