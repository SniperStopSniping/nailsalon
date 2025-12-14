/**
 * Rewards Redeem API Route
 *
 * POST /api/rewards/redeem
 * Redeems a reward by applying it to an existing appointment
 */

import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { appointmentSchema, appointmentServicesSchema, rewardSchema, serviceSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// Default salon slug - in production this would come from subdomain
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const redeemRewardSchema = z.object({
  rewardId: z.string().min(1, 'Reward ID is required'),
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  phone: z.string().regex(/^\d{10,11}$/, 'Phone must be 10-11 digits'),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type SuccessResponse = {
  data: {
    rewardId: string;
    appointmentId: string;
    discountApplied: number;
    newTotalPrice: number;
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
// POST /api/rewards/redeem - Apply a reward to an appointment
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Parse request body
    const body = await request.json();
    const parsed = redeemRewardSchema.safeParse(body);

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

    const { rewardId, appointmentId, phone } = parsed.data;

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

    // 3. Verify the reward exists, belongs to this client, and is active
    const rewards = await db
      .select()
      .from(rewardSchema)
      .where(
        and(
          eq(rewardSchema.id, rewardId),
          eq(rewardSchema.salonId, salon.id),
          eq(rewardSchema.clientPhone, normalizedPhone),
        ),
      )
      .limit(1);

    const reward = rewards[0];

    if (!reward) {
      return Response.json(
        {
          error: {
            code: 'REWARD_NOT_FOUND',
            message: 'Reward not found or does not belong to you',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    if (reward.status !== 'active') {
      return Response.json(
        {
          error: {
            code: 'REWARD_NOT_ACTIVE',
            message: reward.status === 'used'
              ? 'This reward has already been redeemed'
              : 'This reward has expired',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Check if expired
    if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
      // Mark as expired
      await db
        .update(rewardSchema)
        .set({ status: 'expired' })
        .where(eq(rewardSchema.id, rewardId));

      return Response.json(
        {
          error: {
            code: 'REWARD_EXPIRED',
            message: 'This reward has expired',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Verify the appointment exists and belongs to this client
    const phoneVariants = [
      phone,
      normalizedPhone,
      `+1${normalizedPhone}`,
    ];

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

    // Check if appointment already has a reward applied
    const existingReward = await db
      .select()
      .from(rewardSchema)
      .where(eq(rewardSchema.usedInAppointmentId, appointmentId))
      .limit(1);

    if (existingReward.length > 0) {
      return Response.json(
        {
          error: {
            code: 'REWARD_ALREADY_APPLIED',
            message: 'This appointment already has a reward applied',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5. Calculate the discount based on the reward type and appointment services
    let discountApplied = 0;
    const eligibleServiceName = reward.eligibleServiceName?.toLowerCase() || 'gel manicure';

    // Get services for this appointment
    const appointmentServices = await db
      .select({
        serviceId: appointmentServicesSchema.serviceId,
        priceAtBooking: appointmentServicesSchema.priceAtBooking,
      })
      .from(appointmentServicesSchema)
      .where(eq(appointmentServicesSchema.appointmentId, appointmentId));

    if (appointmentServices.length > 0) {
      const serviceIds = appointmentServices.map(as => as.serviceId);
      const services = await db
        .select()
        .from(serviceSchema)
        .where(inArray(serviceSchema.id, serviceIds));

      // Find a matching service to discount
      const matchingService = services.find(
        s => s.name.toLowerCase().includes(eligibleServiceName)
          || eligibleServiceName.includes(s.name.toLowerCase()),
      );

      if (matchingService) {
        // Apply the full service price as discount (prices are in cents)
        const bookedService = appointmentServices.find(as => as.serviceId === matchingService.id);
        discountApplied = bookedService?.priceAtBooking ?? matchingService.price;
      } else {
        // If no matching service, apply points as dollar discount
        // 25000 points = $50 (one free manicure worth), so 500 points = $1
        // Convert to cents: (points / 500) * 100 = points / 5
        const pointsDiscountCents = Math.floor(reward.points / 5);
        discountApplied = Math.min(pointsDiscountCents, appointment.totalPrice);
      }
    }

    // 6. Apply the discount - update appointment and reward
    // All prices are in cents
    const newTotalPrice = Math.max(0, appointment.totalPrice - discountApplied);

    // Format for display (convert cents to dollars)
    const discountDollars = (discountApplied / 100).toFixed(2);

    await db.transaction(async (tx) => {
      // Update the appointment price
      await tx
        .update(appointmentSchema)
        .set({
          totalPrice: newTotalPrice,
          notes: appointment.notes
            ? `${appointment.notes}\n[Reward applied: ${reward.eligibleServiceName || 'Discount'} - $${discountDollars} off]`
            : `[Reward applied: ${reward.eligibleServiceName || 'Discount'} - $${discountDollars} off]`,
        })
        .where(eq(appointmentSchema.id, appointmentId));

      // Mark the reward as pending (will be marked as 'used' when appointment completes)
      await tx
        .update(rewardSchema)
        .set({
          usedInAppointmentId: appointmentId,
          // Keep status as 'active' until appointment completes, then it becomes 'used'
        })
        .where(eq(rewardSchema.id, rewardId));
    });

    // 7. Return success response
    // Convert cents to dollars for display
    const discountAppliedDollars = discountApplied / 100;
    const newTotalPriceDollars = newTotalPrice / 100;

    const response: SuccessResponse = {
      data: {
        rewardId,
        appointmentId,
        discountApplied: discountAppliedDollars,
        newTotalPrice: newTotalPriceDollars,
        message: `Reward applied! You saved $${discountAppliedDollars.toFixed(2)} on your appointment.`,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error('Error redeeming reward:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while redeeming the reward',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
