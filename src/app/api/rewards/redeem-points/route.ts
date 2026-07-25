/**
 * Rewards Redeem Points API Route
 *
 * POST /api/rewards/redeem-points
 * Redeems points from catalog rewards and applies discount to an appointment
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireClientApiSession,
  requireClientSalonFromBody,
} from '@/libs/clientApiGuards';
import {
  lockOperationalSalonClientContactWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { FIRST_VISIT_DISCOUNT_TYPE } from '@/libs/firstVisitDiscount';
import { appointmentSchema, salonClientSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const redeemPointsSchema = z.object({
  rewardTitle: z.string().min(1, 'Reward title is required'),
  rewardPoints: z.number().min(1, 'Points required'),
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  salonSlug: z.string().min(1, 'Salon slug is required').optional(),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type SuccessResponse = {
  data: {
    appointmentId: string;
    pointsSpent: number;
    discountApplied: number;
    newTotalPrice: number;
    newPointsBalance: number;
    message: string;
  };
  meta: {
    timestamp: string;
  };
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type RedemptionTransactionResult =
  | {
    ok: true;
    discountApplied: number;
    newPointsBalance: number;
    newTotalPrice: number;
  }
  | {
    ok: false;
    code:
      | 'APPOINTMENT_NOT_FOUND'
      | 'FIRST_VISIT_DISCOUNT_ALREADY_APPLIED'
      | 'INSUFFICIENT_POINTS'
      | 'INVALID_APPOINTMENT_STATUS';
    message: string;
    status: 400 | 404;
  };

// =============================================================================
// Points to discount conversion
// Catalog rewards still redeem at the existing 25,000 pts = $50 rate.
// So: 500 pts = $1, or 5 pts = 1 cent.
// =============================================================================

function pointsToDiscountCents(points: number): number {
  // 500 points = $1 = 100 cents
  // So 1 point = 0.2 cents, or points / 5 = cents
  return Math.floor(points / 5);
}

// =============================================================================
// POST /api/rewards/redeem-points - Spend points on a catalog reward
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireClientApiSession();
    if (!auth.ok) {
      return auth.response;
    }

    // 1. Parse request body
    const body = await request.json();
    const parsed = redeemPointsSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { rewardTitle, rewardPoints, appointmentId, salonSlug } = parsed.data;
    const normalizedPhone = auth.normalizedPhone;

    // 2. Get the salon
    const salonGuard = await requireClientSalonFromBody(salonSlug);
    if (!salonGuard.ok) {
      return salonGuard.response;
    }
    const { salon } = salonGuard;

    const rewardsGuard = await guardModuleOr403({ salonId: salon.id, module: 'rewards' });
    if (rewardsGuard) {
      return rewardsGuard;
    }

    if (salon.rewardsEnabled === false) {
      return Response.json(
        {
          error: {
            code: 'FEATURE_DISABLED',
            message: 'Rewards program is not available for this salon',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // 3. Get the client's current points balance
    const phoneVariants = [
      normalizedPhone,
      auth.session.phone,
    ];

    const salonClients = await db
      .select({
        id: salonClientSchema.id,
        loyaltyPoints: salonClientSchema.loyaltyPoints,
      })
      .from(salonClientSchema)
      .where(
        and(
          eq(salonClientSchema.salonId, salon.id),
          inArray(salonClientSchema.phone, phoneVariants),
        ),
      )
      .limit(1);

    const salonClient = salonClients[0];

    if (!salonClient) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_NOT_FOUND',
            message: 'Client not found. Please make sure you have an account.',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 4. Verify the appointment exists and belongs to this client. The same
    // predicate is rechecked after both rows are locked inside the transaction.
    const appointments = await db
      .select()
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.id, appointmentId),
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
        ),
      )
      .limit(1);

    const appointment = appointments[0];

    if (!appointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: 'Appointment not found or does not belong to you',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Preserve the existing fast-fail responses. These checks are advisory
    // only; the locked transaction below is authoritative.
    if (!['pending', 'confirmed'].includes(appointment.status)) {
      return Response.json(
        {
          error: {
            code: 'INVALID_APPOINTMENT_STATUS',
            message: 'Rewards can only be applied to pending or confirmed appointments',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    if (appointment.discountType === FIRST_VISIT_DISCOUNT_TYPE) {
      return Response.json(
        {
          error: {
            code: 'FIRST_VISIT_DISCOUNT_ALREADY_APPLIED',
            message: 'Points cannot be redeemed on an appointment that already has the first-visit discount applied',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5. Global order: lock the same-salon terminal client first, then the
    // appointment. Cancellation follows the same order, so neither path can
    // hold one row while waiting for the other in reverse.
    const result = await withClientLifecycleTransactionRetry(() =>
      db.transaction(async (tx): Promise<RedemptionTransactionResult> => {
        const operationalClient
          = await lockOperationalSalonClientContactWithHandle(tx, {
            salonId: salon.id,
            clientId: salonClient.id,
            allowArchived: true,
          });

        const [lockedAppointment] = await tx
          .select()
          .from(appointmentSchema)
          .where(
            and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, salon.id),
              inArray(appointmentSchema.clientPhone, phoneVariants),
            ),
          )
          .for('update')
          .limit(1);

        if (!lockedAppointment) {
          return {
            ok: false,
            code: 'APPOINTMENT_NOT_FOUND',
            message: 'Appointment not found or does not belong to you',
            status: 404,
          };
        }

        if (!['pending', 'confirmed'].includes(lockedAppointment.status)) {
          return {
            ok: false,
            code: 'INVALID_APPOINTMENT_STATUS',
            message: 'Rewards can only be applied to pending or confirmed appointments',
            status: 400,
          };
        }

        if (lockedAppointment.discountType === FIRST_VISIT_DISCOUNT_TYPE) {
          return {
            ok: false,
            code: 'FIRST_VISIT_DISCOUNT_ALREADY_APPLIED',
            message: 'Points cannot be redeemed on an appointment that already has the first-visit discount applied',
            status: 400,
          };
        }

        const [lockedClient] = await tx
          .select({
            loyaltyPoints: salonClientSchema.loyaltyPoints,
          })
          .from(salonClientSchema)
          .where(
            and(
              eq(salonClientSchema.salonId, salon.id),
              eq(salonClientSchema.id, operationalClient.id),
            ),
          )
          .limit(1);
        const lockedPoints = lockedClient?.loyaltyPoints ?? 0;

        if (lockedPoints < rewardPoints) {
          return {
            ok: false,
            code: 'INSUFFICIENT_POINTS',
            message: `You need ${rewardPoints.toLocaleString()} points but only have ${lockedPoints.toLocaleString()}`,
            status: 400,
          };
        }

        const discountCents = pointsToDiscountCents(rewardPoints);
        const discountApplied = Math.min(
          discountCents,
          lockedAppointment.totalPrice,
        );
        const newTotalPrice = Math.max(
          0,
          lockedAppointment.totalPrice - discountApplied,
        );
        const newPointsBalance = lockedPoints - rewardPoints;
        const discountDollars = (discountApplied / 100).toFixed(2);

        await tx
          .update(appointmentSchema)
          .set({
            totalPrice: newTotalPrice,
            notes: lockedAppointment.notes
              ? `${lockedAppointment.notes}\n[Points redeemed: ${rewardTitle} - ${rewardPoints.toLocaleString()} pts for $${discountDollars} off]`
              : `[Points redeemed: ${rewardTitle} - ${rewardPoints.toLocaleString()} pts for $${discountDollars} off]`,
          })
          .where(
            and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, salon.id),
              eq(appointmentSchema.status, lockedAppointment.status),
            ),
          );

        await tx
          .update(salonClientSchema)
          .set({
            loyaltyPoints: sql`COALESCE(${salonClientSchema.loyaltyPoints}, 0) - ${rewardPoints}`,
          })
          .where(
            and(
              eq(salonClientSchema.salonId, salon.id),
              eq(salonClientSchema.id, operationalClient.id),
            ),
          );

        return {
          ok: true,
          discountApplied,
          newPointsBalance,
          newTotalPrice,
        };
      }),
    );

    if (!result.ok) {
      return Response.json(
        {
          error: {
            code: result.code,
            message: result.message,
          },
        } satisfies ErrorResponse,
        { status: result.status },
      );
    }

    // 6. Return success response (convert cents to dollars for display)
    const discountAppliedDollars = result.discountApplied / 100;
    const newTotalPriceDollars = result.newTotalPrice / 100;

    const response: SuccessResponse = {
      data: {
        appointmentId,
        pointsSpent: rewardPoints,
        discountApplied: discountAppliedDollars,
        newTotalPrice: newTotalPriceDollars,
        newPointsBalance: result.newPointsBalance,
        message: `Success! You used ${rewardPoints.toLocaleString()} points and saved $${discountAppliedDollars.toFixed(2)}.`,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error('Error redeeming points:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while redeeming points',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
