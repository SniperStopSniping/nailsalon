/**
 * Generate Referral Link API Route
 *
 * Creates a referral record and returns a shareable link.
 * The referee info is NOT filled at this point - it's filled when they claim.
 *
 * POST /api/referrals/generate
 * Body: { salonSlug, referrerPhone, referrerName }
 */

import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { referralSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const generateReferralSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  referrerPhone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  referrerName: z.string().min(1, 'Referrer name is required'),
});

type GenerateReferralRequest = z.infer<typeof generateReferralSchema>;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type SuccessResponse = {
  data: {
    referralId: string;
    referralUrl: string;
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
 * Generate a short, URL-friendly referral code
 */
function generateReferralCode(): string {
  // Generate 8-character alphanumeric code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// =============================================================================
// POST /api/referrals/generate - Generate a shareable referral link
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const parsed = generateReferralSchema.safeParse(body);

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      let userMessage = 'Invalid request data';

      if (fieldErrors.referrerPhone) {
        userMessage = 'Your phone number is invalid. Please try again.';
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

    const data: GenerateReferralRequest = parsed.data;

    // 2. Resolve salon from slug
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

    // 3. Generate a unique referral code
    const referralCode = generateReferralCode();
    const referralId = `ref_${referralCode}`;

    // 4. Create the referral record (no referee info yet - that's filled on claim)
    await db.insert(referralSchema).values({
      id: referralId,
      salonId: salon.id,
      referrerPhone: data.referrerPhone,
      referrerName: data.referrerName,
      status: 'sent',
      // refereePhone and refereeName are null until claim
    });

    // 5. Build the referral URL
    // In production, this would use the actual domain
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const referralUrl = `${baseUrl}/referral/${referralId}`;

    // 6. Return success response
    const response: SuccessResponse = {
      data: {
        referralId,
        referralUrl,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return Response.json(response, { status: 201 });
  } catch (error) {
    console.error('Error generating referral:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while generating the referral link',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
