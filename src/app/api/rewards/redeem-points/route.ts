/**
 * Rewards Redeem Points API Route
 *
 * POST /api/rewards/redeem-points
 * Redeems points from catalog rewards and applies discount to an appointment
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { appointmentSchema, salonClientSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// Default salon slug - in production this would come from subdomain
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const redeemPointsSchema = z.object({
  rewardTitle: z.string().min(1, 'Reward title is required'),
  rewardPoints: z.number().min(1, 'Points required'),
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  phone: z.string().regex(/^\d{10,11}$/, 'Phone must be 10-11 digits'),
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

// =============================================================================
// Points to discount conversion
// Based on: 25,000 pts = $50 (free gel manicure value)
// So: 500 pts = $1, or 5 pts = 1 cent
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

    const { rewardTitle, rewardPoints, appointmentId, phone } = parsed.data;

    // Normalize phone
    const normalizedPhone = phone.length === 11 && phone.startsWith('1')
      ? phone.slice(1)
      : phone;

    // 2. Get the salon
    const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3. Get the client's current points balance
    const phoneVariants = [
      normalizedPhone,
      `+1${normalizedPhone}`,
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

    const currentPoints = salonClient.loyaltyPoints ?? 0;

    // 4. Check if client has enough points
    if (currentPoints < rewardPoints) {
      return Response.json(
        {
          error: {
            code: 'INSUFFICIENT_POINTS',
            message: `You need ${rewardPoints.toLocaleString()} points but only have ${currentPoints.toLocaleString()}`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5. Verify the appointment exists and belongs to this client
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

    // Check appointment status - only allow for pending/confirmed
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

    // 6. Calculate the discount (in cents)
    const discountCents = pointsToDiscountCents(rewardPoints);
    const discountApplied = Math.min(discountCents, appointment.totalPrice);
    const newTotalPrice = Math.max(0, appointment.totalPrice - discountApplied);
    const newPointsBalance = currentPoints - rewardPoints;

    // Format for display
    const discountDollars = (discountApplied / 100).toFixed(2);

    // 7. Apply the discount and deduct points in a transaction
    await db.transaction(async (tx) => {
      // Update the appointment price
      await tx
        .update(appointmentSchema)
        .set({
          totalPrice: newTotalPrice,
          notes: appointment.notes
            ? `${appointment.notes}\n[Points redeemed: ${rewardTitle} - ${rewardPoints.toLocaleString()} pts for $${discountDollars} off]`
            : `[Points redeemed: ${rewardTitle} - ${rewardPoints.toLocaleString()} pts for $${discountDollars} off]`,
        })
        .where(eq(appointmentSchema.id, appointmentId));

      // Deduct points from client's balance
      await tx
        .update(salonClientSchema)
        .set({
          loyaltyPoints: sql`GREATEST(0, COALESCE(${salonClientSchema.loyaltyPoints}, 0) - ${rewardPoints})`,
        })
        .where(eq(salonClientSchema.id, salonClient.id));
    });

    // 8. Return success response (convert cents to dollars for display)
    const discountAppliedDollars = discountApplied / 100;
    const newTotalPriceDollars = newTotalPrice / 100;

    const response: SuccessResponse = {
      data: {
        appointmentId,
        pointsSpent: rewardPoints,
        discountApplied: discountAppliedDollars,
        newTotalPrice: newTotalPriceDollars,
        newPointsBalance,
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
