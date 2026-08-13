/**
 * Rewards Redeem API Route
 *
 * POST /api/rewards/redeem
 * Redeems a reward by applying it to an existing appointment
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireClientApiSession,
  requireClientSalonFromBody,
} from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { FIRST_VISIT_DISCOUNT_TYPE } from '@/libs/firstVisitDiscount';
import { enqueueGoogleCalendarAppointmentMutation } from '@/libs/integrationOutbox';
import { calculateRewardDiscountCents, getRewardDisplayContent } from '@/libs/rewardRules';
import { appointmentSchema, appointmentServicesSchema, rewardSchema, serviceSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const redeemRewardSchema = z.object({
  rewardId: z.string().min(1, 'Reward ID is required'),
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  salonSlug: z.string().min(1, 'Salon slug is required').optional(),
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

class RewardRedemptionConflictError extends Error {
  constructor() {
    super('REWARD_REDEMPTION_CONFLICT');
    this.name = 'RewardRedemptionConflictError';
  }
}

// =============================================================================
// POST /api/rewards/redeem - Apply a reward to an appointment
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireClientApiSession();
    if (!auth.ok) {
      return auth.response;
    }

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

    const { rewardId, appointmentId, salonSlug } = parsed.data;
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
      normalizedPhone,
      auth.session.phone,
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

    if (appointment.discountType === FIRST_VISIT_DISCOUNT_TYPE) {
      return Response.json(
        {
          error: {
            code: 'FIRST_VISIT_DISCOUNT_ALREADY_APPLIED',
            message: 'Rewards cannot be added to an appointment that already has the first-visit discount applied',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Check if appointment already has a reward applied
    const existingReward = await db
      .select()
      .from(rewardSchema)
      .where(
        and(
          eq(rewardSchema.usedInAppointmentId, appointmentId),
          eq(rewardSchema.salonId, salon.id),
        ),
      )
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

    // 5. Load the appointment services used by the locked pricing calculation.
    const appointmentServices = await db
      .select({
        serviceId: appointmentServicesSchema.serviceId,
        priceAtBooking: appointmentServicesSchema.priceAtBooking,
      })
      .from(appointmentServicesSchema)
      .where(eq(appointmentServicesSchema.appointmentId, appointmentId));
    let rewardServices: Array<typeof serviceSchema.$inferSelect> = [];

    if (appointmentServices.length > 0) {
      const serviceIds = appointmentServices.map(as => as.serviceId);
      rewardServices = await db
        .select()
        .from(serviceSchema)
        .where(inArray(serviceSchema.id, serviceIds));
    }

    // 6. Apply the discount and publish the matching Calendar revision atomically.
    const redemption = await db.transaction(async (tx) => {
      // Appointment before reward is the shared reward-writer lock order. Every
      // mutable eligibility and pricing value below comes from these locked
      // rows, never from the advisory reads above.
      const [lockedAppointment] = await tx
        .select()
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.id, appointmentId),
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
        ))
        .for('update')
        .limit(1);
      if (
        !lockedAppointment
        || !['pending', 'confirmed'].includes(lockedAppointment.status)
        || lockedAppointment.discountType === FIRST_VISIT_DISCOUNT_TYPE
      ) {
        throw new RewardRedemptionConflictError();
      }

      const [linkedReward] = await tx
        .select({ id: rewardSchema.id })
        .from(rewardSchema)
        .where(and(
          eq(rewardSchema.usedInAppointmentId, appointmentId),
          eq(rewardSchema.salonId, salon.id),
        ))
        .limit(1);
      if (linkedReward) {
        throw new RewardRedemptionConflictError();
      }

      const [lockedReward] = await tx
        .select()
        .from(rewardSchema)
        .where(and(
          eq(rewardSchema.id, rewardId),
          eq(rewardSchema.salonId, salon.id),
          inArray(rewardSchema.clientPhone, phoneVariants),
        ))
        .for('update')
        .limit(1);
      if (
        !lockedReward
        || lockedReward.status !== 'active'
        || lockedReward.usedInAppointmentId !== null
        || (lockedReward.expiresAt !== null && lockedReward.expiresAt < new Date())
      ) {
        throw new RewardRedemptionConflictError();
      }

      const lockedDiscountApplied = appointmentServices.length > 0
        ? calculateRewardDiscountCents({
          reward: lockedReward,
          subtotalBeforeDiscountCents: lockedAppointment.totalPrice,
          services: appointmentServices.map(item => ({
            id: item.serviceId,
            name: rewardServices.find(service => service.id === item.serviceId)?.name ?? '',
            price: item.priceAtBooking
              ?? rewardServices.find(service => service.id === item.serviceId)?.price
              ?? 0,
          })),
        }).discountAmountCents
        : 0;
      const lockedNewTotalPrice = Math.max(
        0,
        lockedAppointment.totalPrice - lockedDiscountApplied,
      );
      const lockedDiscountDollars = (lockedDiscountApplied / 100).toFixed(2);
      const lockedRewardDisplay = getRewardDisplayContent(lockedReward);

      // Update the appointment price
      const [pricedAppointment] = await tx
        .update(appointmentSchema)
        .set({
          totalPrice: lockedNewTotalPrice,
          notes: lockedAppointment.notes
            ? `${lockedAppointment.notes}\n[Reward applied: ${lockedRewardDisplay.title} - $${lockedDiscountDollars} off]`
            : `[Reward applied: ${lockedRewardDisplay.title} - $${lockedDiscountDollars} off]`,
          updatedAt: new Date(Math.max(
            Date.now(),
            lockedAppointment.updatedAt.getTime() + 1,
          )),
        })
        .where(
          and(
            eq(appointmentSchema.id, appointmentId),
            eq(appointmentSchema.salonId, salon.id),
            inArray(appointmentSchema.status, ['pending', 'confirmed']),
          ),
        )
        .returning();
      if (!pricedAppointment) {
        throw new RewardRedemptionConflictError();
      }

      // Mark the reward as pending (will be marked as 'used' when appointment completes)
      const claimedReward = await tx
        .update(rewardSchema)
        .set({
          usedInAppointmentId: appointmentId,
          // Keep status as 'active' until appointment completes, then it becomes 'used'
        })
        .where(and(
          eq(rewardSchema.id, rewardId),
          eq(rewardSchema.salonId, salon.id),
          inArray(rewardSchema.clientPhone, phoneVariants),
          eq(rewardSchema.status, 'active'),
          isNull(rewardSchema.usedInAppointmentId),
        ))
        .returning();
      if (claimedReward.length !== 1) {
        // This rolls the appointment price change back with the failed claim.
        throw new RewardRedemptionConflictError();
      }

      await enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: pricedAppointment.id,
        salonId: pricedAppointment.salonId,
        mutationVersion: pricedAppointment.updatedAt,
      });

      return {
        discountApplied: lockedDiscountApplied,
        newTotalPrice: lockedNewTotalPrice,
        rewardTitle: lockedRewardDisplay.title,
      };
    });

    // 7. Return success response
    // Convert cents to dollars for display
    const discountAppliedDollars = redemption.discountApplied / 100;
    const newTotalPriceDollars = redemption.newTotalPrice / 100;

    const response: SuccessResponse = {
      data: {
        rewardId,
        appointmentId,
        discountApplied: discountAppliedDollars,
        newTotalPrice: newTotalPriceDollars,
        message: `Reward applied! ${redemption.rewardTitle} saved you $${discountAppliedDollars.toFixed(2)} on your appointment.`,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof RewardRedemptionConflictError) {
      return Response.json(
        {
          error: {
            code: 'REWARD_NOT_ACTIVE',
            message: 'This reward is already reserved or has been redeemed.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
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
