import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireClientApiSession,
  requireClientSalonFromBody,
} from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { sendReferralInvite } from '@/libs/SMS';
import { appointmentSchema, clientSchema, referralSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const sendReferralSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  referrerName: z.string().min(1, 'Referrer name is required').optional(),
  refereePhone: z.string().regex(/^\d{10}$/, 'Friend phone must be 10 digits'),
});

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
// Caller identity is derived from the authenticated client session.
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireClientApiSession();
    if (!auth.ok) {
      return auth.response;
    }

    // 1. Parse and validate request body
    const body = await request.json();
    const parsed = sendReferralSchema.safeParse(body);

    if (!parsed.success) {
      // Create a user-friendly error message based on which field failed
      const fieldErrors = parsed.error.flatten().fieldErrors;
      let userMessage = 'Invalid request data';

      if (fieldErrors.refereePhone) {
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

    const { salonSlug, referrerName, refereePhone } = parsed.data;
    const resolvedReferrerName = auth.session.clientName ?? referrerName ?? 'Your friend';

    // 2. Validate: can't refer yourself
    if (auth.normalizedPhone === refereePhone) {
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

    // 3. Resolve salon from tenant context
    const salonGuard = await requireClientSalonFromBody(salonSlug);
    if (!salonGuard.ok) {
      return salonGuard.response;
    }
    const { salon } = salonGuard;

    // 3.5. Check if referrals module is enabled (Step 16.3)
    // Uses effective gating: entitled AND adminEnabled
    const moduleGuard = await guardModuleOr403({ salonId: salon.id, module: 'referrals' });
    if (moduleGuard) {
      return moduleGuard;
    }

    // 4. Check if this referral already exists
    const existingReferral = await db
      .select()
      .from(referralSchema)
      .where(
        and(
          eq(referralSchema.salonId, salon.id),
          eq(referralSchema.referrerPhone, auth.normalizedPhone),
          eq(referralSchema.refereePhone, refereePhone),
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
      refereePhone,
      `+1${refereePhone}`,
      `+${refereePhone}`,
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
      referrerPhone: auth.normalizedPhone,
      referrerName: resolvedReferrerName,
      refereePhone,
      status: 'sent', // Use 'sent' to match schema definition
    });

    // 7. Send the SMS with claim link (gated by smsRemindersEnabled toggle)
    const smsSent = await sendReferralInvite(salon.id, {
      refereePhone,
      referrerName: resolvedReferrerName,
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
