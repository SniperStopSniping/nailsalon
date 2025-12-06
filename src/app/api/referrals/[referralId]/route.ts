/**
 * Get Referral Info API Route
 *
 * Returns referral info for the claim page (referrer name, masked phone, salon info).
 *
 * GET /api/referrals/[referralId]
 */

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { referralSchema, salonSchema } from '@/models/Schema';

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface ReferralInfoResponse {
  data: {
    referralId: string;
    referrerName: string | null;
    referrerPhoneMasked: string; // "XXX-XXX-1234"
    salonName: string;
    salonSlug: string;
    status: string;
    isClaimable: boolean;
  };
  meta: {
    timestamp: string;
  };
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Mask phone number: "4161234567" -> "XXX-XXX-4567"
 */
function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return 'XXX-XXX-XXXX';
  const last4 = phone.slice(-4);
  return `XXX-XXX-${last4}`;
}

// =============================================================================
// GET /api/referrals/[referralId] - Get referral info for claim page
// =============================================================================

export async function GET(
  _request: Request,
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

    // 1. Look up the referral
    const referralResults = await db
      .select({
        referral: referralSchema,
        salon: salonSchema,
      })
      .from(referralSchema)
      .innerJoin(salonSchema, eq(referralSchema.salonId, salonSchema.id))
      .where(eq(referralSchema.id, referralId))
      .limit(1);

    if (referralResults.length === 0) {
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

    const { referral, salon } = referralResults[0]!;

    // 2. Check if referral is still claimable
    // Claimable if status is 'sent' (not yet claimed)
    const isClaimable = referral.status === 'sent';

    // 3. Build response
    const response: ReferralInfoResponse = {
      data: {
        referralId: referral.id,
        referrerName: referral.referrerName,
        referrerPhoneMasked: maskPhone(referral.referrerPhone),
        salonName: salon.name,
        salonSlug: salon.slug,
        status: referral.status,
        isClaimable,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching referral:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
