import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { createFeatureDisabledResponse, isRewardsEnabled } from '@/libs/salonStatus';
import { sendReferralInvite } from '@/libs/SMS';
import { appointmentSchema, clientSchema, referralSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const sendReferralSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  referrerPhone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  referrerName: z.string().min(1, 'Referrer name is required'),
  refereePhone: z.string().regex(/^\d{10}$/, 'Friend phone must be 10 digits'),
});

type SendReferralRequest = z.infer<typeof sendReferralSchema>;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type SuccessResponse = {
  data: {
    referralId: string;
    smsSent: boolean;
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
// POST /api/referrals/send - Send a referral to a friend
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const parsed = sendReferralSchema.safeParse(body);

    if (!parsed.success) {
      // Create a user-friendly error message based on which field failed
      const fieldErrors = parsed.error.flatten().fieldErrors;
      let userMessage = 'Invalid request data';

      if (fieldErrors.referrerPhone) {
        userMessage = 'Your phone number is invalid. Please try again or contact support.';
      } else if (fieldErrors.refereePhone) {
        userMessage = 'Please enter a valid 10-digit phone number for your friend.';
      } else if (fieldErrors.salonSlug) {
        userMessage = 'Unable to identify salon. Please refresh and try again.';
      } else if (fieldErrors.referrerName) {
        userMessage = 'Unable to identify your name. Please refresh and try again.';
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

    const data: SendReferralRequest = parsed.data;

    // 2. Validate: can't refer yourself
    if (data.referrerPhone === data.refereePhone) {
      return Response.json(
        {
          error: {
            code: 'SELF_REFERRAL',
            message: 'You cannot refer yourself',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 3. Resolve salon from slug
    const salon = await getSalonBySlug(data.salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: `Salon with slug "${data.salonSlug}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3.5. Check if rewards/referrals are enabled for this salon
    if (!await isRewardsEnabled(salon.id)) {
      return createFeatureDisabledResponse('rewards');
    }

    // 4. Check if this referral already exists
    const existingReferral = await db
      .select()
      .from(referralSchema)
      .where(
        and(
          eq(referralSchema.salonId, salon.id),
          eq(referralSchema.referrerPhone, data.referrerPhone),
          eq(referralSchema.refereePhone, data.refereePhone),
        ),
      )
      .limit(1);

    if (existingReferral.length > 0) {
      return Response.json(
        {
          error: {
            code: 'DUPLICATE_REFERRAL',
            message: 'You have already sent a referral to this phone number',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 5. Check if referee phone belongs to an existing client
    // This prevents referrals to people who already have accounts
    const phoneVariants = [
      data.refereePhone,
      `+1${data.refereePhone}`,
      `+${data.refereePhone}`,
    ];

    // Check appointments table for existing bookings at this salon
    const existingAppointments = await db
      .select({ id: appointmentSchema.id })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
        ),
      )
      .limit(1);

    if (existingAppointments.length > 0) {
      return Response.json(
        {
          error: {
            code: 'EXISTING_CLIENT',
            message: 'This phone number belongs to an existing client and is not eligible for a new client referral.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Also check client table for verified users
    const existingClient = await db
      .select({ id: clientSchema.id })
      .from(clientSchema)
      .where(inArray(clientSchema.phone, phoneVariants))
      .limit(1);

    if (existingClient.length > 0) {
      return Response.json(
        {
          error: {
            code: 'EXISTING_CLIENT',
            message: 'This phone number belongs to an existing client and is not eligible for a new client referral.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 6. Create the referral record
    const referralId = `ref_${crypto.randomUUID()}`;

    await db.insert(referralSchema).values({
      id: referralId,
      salonId: salon.id,
      referrerPhone: data.referrerPhone,
      referrerName: data.referrerName,
      refereePhone: data.refereePhone,
      status: 'sent', // Use 'sent' to match schema definition
    });

    // 7. Send the SMS with claim link (gated by smsRemindersEnabled toggle)
    const smsSent = await sendReferralInvite(salon.id, {
      refereePhone: data.refereePhone,
      referrerName: data.referrerName,
      salonName: salon.name,
      referralId,
    });

    // 8. Return success response
    const response: SuccessResponse = {
      data: {
        referralId,
        smsSent,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return Response.json(response, { status: 201 });
  } catch (error) {
    console.error('Error sending referral:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while sending the referral',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
