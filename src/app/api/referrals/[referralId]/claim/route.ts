/**
 * Claim Referral API Route
 *
 * Claims a referral after the friend has verified their phone via OTP.
 * - Updates the referral with referee info
 * - Creates/updates client record
 * - Creates a reward for the referee
 * - Sets claimedAt and expiresAt (14 days)
 *
 * POST /api/referrals/[referralId]/claim
 * Body: { refereeName, refereePhone }
 */

import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { resolveSalonLoyaltyPoints } from '@/libs/loyalty';
import { upsertClient } from '@/libs/queries';
import { appointmentSchema, referralSchema, rewardSchema, salonSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const claimReferralSchema = z.object({
  refereeName: z.string().min(1, 'Name is required'),
  refereePhone: z.string().regex(/^\+?1?\d{10,11}$/, 'Invalid phone number'),
});

type ClaimReferralRequest = z.infer<typeof claimReferralSchema>;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type SuccessResponse = {
  data: {
    referralId: string;
    rewardId: string;
    expiresAt: string;
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
// HELPERS
// =============================================================================

/**
 * Normalize phone to 10 digits
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Remove leading 1 if 11 digits
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

// =============================================================================
// POST /api/referrals/[referralId]/claim - Claim a referral
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ referralId: string }> },
): Promise<Response> {
  try {
    const { referralId } = await params;

    if (!referralId) {
      return Response.json(
        {
          error: {
            code: 'INVALID_REFERRAL_ID',
            message: 'Referral ID is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 1. Parse and validate request body
    const body = await request.json();
    const parsed = claimReferralSchema.safeParse(body);

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

    const data: ClaimReferralRequest = parsed.data;
    const normalizedPhone = normalizePhone(data.refereePhone);

    // 2. Look up the referral
    const [referral] = await db
      .select()
      .from(referralSchema)
      .where(eq(referralSchema.id, referralId))
      .limit(1);

    if (!referral) {
      return Response.json(
        {
          error: {
            code: 'REFERRAL_NOT_FOUND',
            message: 'This referral link is invalid or has expired',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 2b. Fetch salon to resolve loyalty points
    const [salon] = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, referral.salonId))
      .limit(1);

    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'The salon for this referral no longer exists',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Resolve effective loyalty points for this salon
    const loyaltyPoints = resolveSalonLoyaltyPoints(salon);

    // 3. Check if referral is still claimable
    if (referral.status !== 'sent') {
      return Response.json(
        {
          error: {
            code: 'REFERRAL_ALREADY_CLAIMED',
            message: 'This referral has already been claimed',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 3b. If referral was sent to a specific phone, validate it matches the claiming phone
    // This prevents someone from stealing a referral meant for another person
    if (referral.refereePhone && referral.refereePhone !== normalizedPhone) {
      return Response.json(
        {
          error: {
            code: 'PHONE_MISMATCH',
            message: 'This referral was sent to a different phone number. Please use the phone number the referral was sent to.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Validate: can't claim your own referral
    if (normalizedPhone === referral.referrerPhone) {
      return Response.json(
        {
          error: {
            code: 'SELF_REFERRAL',
            message: 'You cannot claim your own referral',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5. Check if phone belongs to an existing client who has booked before
    // This prevents existing customers from gaming the system with "new client" referral rewards
    const phoneVariants = [
      normalizedPhone,
      `+1${normalizedPhone}`,
      `+${normalizedPhone}`,
    ];

    // Check if this phone has any completed/confirmed appointments at this salon
    const existingAppointments = await db
      .select({ id: appointmentSchema.id })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, referral.salonId),
          inArray(appointmentSchema.clientPhone, phoneVariants),
          inArray(appointmentSchema.status, ['confirmed', 'completed']),
        ),
      )
      .limit(1);

    if (existingAppointments.length > 0) {
      return Response.json(
        {
          error: {
            code: 'EXISTING_CLIENT',
            message: 'This phone number is already registered with us and isn\'t eligible for a new client referral reward.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Also check if this phone has already claimed another referral at this salon
    const existingReferralClaim = await db
      .select({ id: referralSchema.id })
      .from(referralSchema)
      .where(
        and(
          eq(referralSchema.salonId, referral.salonId),
          inArray(referralSchema.refereePhone, phoneVariants),
          ne(referralSchema.id, referralId), // Exclude current referral
          inArray(referralSchema.status, ['claimed', 'booked', 'reward_earned']),
        ),
      )
      .limit(1);

    if (existingReferralClaim.length > 0) {
      return Response.json(
        {
          error: {
            code: 'ALREADY_CLAIMED_REFERRAL',
            message: 'You have already claimed a referral reward at this salon. Each customer can only use one new client referral.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 7. Calculate expiration (14 days from now)
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 14);

    // 8. Update the referral with referee info
    await db
      .update(referralSchema)
      .set({
        refereePhone: normalizedPhone,
        refereeName: data.refereeName,
        status: 'claimed',
        claimedAt: now,
        expiresAt,
      })
      .where(eq(referralSchema.id, referralId));

    // 9. Create/update client record for the referee
    await upsertClient(`+1${normalizedPhone}`, data.refereeName);

    // 10. Create a reward for the referee (uses salon-resolved points)
    const rewardId = `reward_${crypto.randomUUID()}`;
    await db.insert(rewardSchema).values({
      id: rewardId,
      salonId: referral.salonId,
      clientPhone: normalizedPhone,
      clientName: data.refereeName,
      referralId,
      type: 'referral_referee',
      points: loyaltyPoints.referralReferee,
      eligibleServiceName: 'Gel Manicure',
      status: 'active',
      expiresAt,
    });

    // 11. Return success response
    const response: SuccessResponse = {
      data: {
        referralId,
        rewardId,
        expiresAt: expiresAt.toISOString(),
        message: 'You\'ve claimed your free manicure! Your reward is now linked to your profile.',
      },
      meta: {
        timestamp: now.toISOString(),
      },
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error('Error claiming referral:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while claiming the referral',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
