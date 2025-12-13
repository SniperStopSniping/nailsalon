/**
 * Salon Admin Policies API Route
 *
 * GET - Get current salon policy (for admin's salon)
 * PUT - Update salon policy (for admin's salon)
 *
 * Protected by getAdminSession(). Derives salonId from session, not from client.
 */

import {
  getSalonPolicy,
  getSuperAdminPolicy,
  upsertSalonPolicy,
} from '@/core/appointments/policyRepo';
import { resolveEffectivePolicy } from '@/core/appointments/policyResolver';
import {
  normalizeSalonPolicyInput,
  SalonPolicyInputSchema,
} from '@/core/appointments/policySchemas';
import { getAdminSession } from '@/libs/adminAuth';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

// =============================================================================
// GET /api/admin/policies
// =============================================================================

export async function GET(): Promise<Response> {
  // Auth check - get admin session
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Not authenticated',
        },
      } satisfies ErrorResponse,
      { status: 401 },
    );
  }

  // Derive salonId from admin's first salon membership
  // (In production, you might want to allow selecting which salon via query param)
  const salonMembership = admin.salons[0];
  if (!salonMembership) {
    return Response.json(
      {
        error: {
          code: 'NO_SALON',
          message: 'You are not a member of any salon',
        },
      } satisfies ErrorResponse,
      { status: 403 },
    );
  }

  const salonId = salonMembership.salonId;

  try {
    // Fetch both policies
    const [salonPolicy, superAdminPolicy] = await Promise.all([
      getSalonPolicy(undefined, salonId),
      getSuperAdminPolicy(),
    ]);

    // Compute effective policy
    const effectivePolicy = resolveEffectivePolicy({
      salon: {
        requireBeforePhotoToStart: salonPolicy.requireBeforePhotoToStart as 'off' | 'optional' | 'required',
        requireAfterPhotoToFinish: salonPolicy.requireAfterPhotoToFinish as 'off' | 'optional' | 'required',
        requireAfterPhotoToPay: salonPolicy.requireAfterPhotoToPay as 'off' | 'optional' | 'required',
        autoPostEnabled: salonPolicy.autoPostEnabled,
        autoPostPlatforms: salonPolicy.autoPostPlatforms as Array<'instagram' | 'facebook' | 'tiktok'>,
        autoPostIncludePrice: salonPolicy.autoPostIncludePrice,
        autoPostIncludeColor: salonPolicy.autoPostIncludeColor,
        autoPostIncludeBrand: salonPolicy.autoPostIncludeBrand,
        autoPostAIcaptionEnabled: salonPolicy.autoPostAiCaptionEnabled,
      },
      superAdmin: {
        requireBeforePhotoToStart: superAdminPolicy.requireBeforePhotoToStart as 'off' | 'optional' | 'required' | undefined,
        requireAfterPhotoToFinish: superAdminPolicy.requireAfterPhotoToFinish as 'off' | 'optional' | 'required' | undefined,
        requireAfterPhotoToPay: superAdminPolicy.requireAfterPhotoToPay as 'off' | 'optional' | 'required' | undefined,
        autoPostEnabled: superAdminPolicy.autoPostEnabled ?? undefined,
        autoPostAIcaptionEnabled: superAdminPolicy.autoPostAiCaptionEnabled ?? undefined,
      },
    });

    return Response.json({
      data: {
        salonPolicy: {
          requireBeforePhotoToStart: salonPolicy.requireBeforePhotoToStart,
          requireAfterPhotoToFinish: salonPolicy.requireAfterPhotoToFinish,
          requireAfterPhotoToPay: salonPolicy.requireAfterPhotoToPay,
          autoPostEnabled: salonPolicy.autoPostEnabled,
          autoPostPlatforms: salonPolicy.autoPostPlatforms,
          autoPostIncludePrice: salonPolicy.autoPostIncludePrice,
          autoPostIncludeColor: salonPolicy.autoPostIncludeColor,
          autoPostIncludeBrand: salonPolicy.autoPostIncludeBrand,
          autoPostAiCaptionEnabled: salonPolicy.autoPostAiCaptionEnabled,
        },
        superAdminPolicy: {
          requireBeforePhotoToStart: superAdminPolicy.requireBeforePhotoToStart,
          requireAfterPhotoToFinish: superAdminPolicy.requireAfterPhotoToFinish,
          requireAfterPhotoToPay: superAdminPolicy.requireAfterPhotoToPay,
          autoPostEnabled: superAdminPolicy.autoPostEnabled,
          autoPostAiCaptionEnabled: superAdminPolicy.autoPostAiCaptionEnabled,
        },
        effectivePolicy: {
          requireBeforePhotoToStart: effectivePolicy.requireBeforePhotoToStart,
          requireAfterPhotoToFinish: effectivePolicy.requireAfterPhotoToFinish,
          requireAfterPhotoToPay: effectivePolicy.requireAfterPhotoToPay,
          autoPostEnabled: effectivePolicy.autoPostEnabled,
          autoPostPlatforms: effectivePolicy.autoPostPlatforms,
          autoPostIncludePrice: effectivePolicy.autoPostIncludePrice,
          autoPostIncludeColor: effectivePolicy.autoPostIncludeColor,
          autoPostIncludeBrand: effectivePolicy.autoPostIncludeBrand,
          autoPostAiCaptionEnabled: effectivePolicy.autoPostAIcaptionEnabled,
        },
        salonId,
        salonName: salonMembership.salonName,
        isDefault: salonPolicy.isDefault,
        updatedAt: salonPolicy.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error('Error fetching salon policy:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch policy',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/admin/policies
// =============================================================================

export async function PUT(request: Request): Promise<Response> {
  // Auth check - get admin session
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Not authenticated',
        },
      } satisfies ErrorResponse,
      { status: 401 },
    );
  }

  // Derive salonId from admin's first salon membership
  // SECURITY: Always use session-derived salonId, never trust client
  const salonMembership = admin.salons[0];
  if (!salonMembership) {
    return Response.json(
      {
        error: {
          code: 'NO_SALON',
          message: 'You are not a member of any salon',
        },
      } satisfies ErrorResponse,
      { status: 403 },
    );
  }

  const salonId = salonMembership.salonId;

  try {
    // Parse request body
    const body = await request.json();

    // Validate with Zod
    const parsed = SalonPolicyInputSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid policy data',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Normalize input
    const normalized = normalizeSalonPolicyInput(parsed.data);

    // Upsert policy for this salon only
    const updated = await upsertSalonPolicy(undefined, salonId, normalized);

    // Fetch super admin policy to compute effective
    const superAdminPolicy = await getSuperAdminPolicy();

    // Compute effective policy
    const effectivePolicy = resolveEffectivePolicy({
      salon: {
        requireBeforePhotoToStart: updated.requireBeforePhotoToStart as 'off' | 'optional' | 'required',
        requireAfterPhotoToFinish: updated.requireAfterPhotoToFinish as 'off' | 'optional' | 'required',
        requireAfterPhotoToPay: updated.requireAfterPhotoToPay as 'off' | 'optional' | 'required',
        autoPostEnabled: updated.autoPostEnabled,
        autoPostPlatforms: updated.autoPostPlatforms as Array<'instagram' | 'facebook' | 'tiktok'>,
        autoPostIncludePrice: updated.autoPostIncludePrice,
        autoPostIncludeColor: updated.autoPostIncludeColor,
        autoPostIncludeBrand: updated.autoPostIncludeBrand,
        autoPostAIcaptionEnabled: updated.autoPostAiCaptionEnabled,
      },
      superAdmin: {
        requireBeforePhotoToStart: superAdminPolicy.requireBeforePhotoToStart as 'off' | 'optional' | 'required' | undefined,
        requireAfterPhotoToFinish: superAdminPolicy.requireAfterPhotoToFinish as 'off' | 'optional' | 'required' | undefined,
        requireAfterPhotoToPay: superAdminPolicy.requireAfterPhotoToPay as 'off' | 'optional' | 'required' | undefined,
        autoPostEnabled: superAdminPolicy.autoPostEnabled ?? undefined,
        autoPostAIcaptionEnabled: superAdminPolicy.autoPostAiCaptionEnabled ?? undefined,
      },
    });

    return Response.json({
      data: {
        salonPolicy: {
          requireBeforePhotoToStart: updated.requireBeforePhotoToStart,
          requireAfterPhotoToFinish: updated.requireAfterPhotoToFinish,
          requireAfterPhotoToPay: updated.requireAfterPhotoToPay,
          autoPostEnabled: updated.autoPostEnabled,
          autoPostPlatforms: updated.autoPostPlatforms,
          autoPostIncludePrice: updated.autoPostIncludePrice,
          autoPostIncludeColor: updated.autoPostIncludeColor,
          autoPostIncludeBrand: updated.autoPostIncludeBrand,
          autoPostAiCaptionEnabled: updated.autoPostAiCaptionEnabled,
        },
        effectivePolicy: {
          requireBeforePhotoToStart: effectivePolicy.requireBeforePhotoToStart,
          requireAfterPhotoToFinish: effectivePolicy.requireAfterPhotoToFinish,
          requireAfterPhotoToPay: effectivePolicy.requireAfterPhotoToPay,
          autoPostEnabled: effectivePolicy.autoPostEnabled,
          autoPostPlatforms: effectivePolicy.autoPostPlatforms,
          autoPostIncludePrice: effectivePolicy.autoPostIncludePrice,
          autoPostIncludeColor: effectivePolicy.autoPostIncludeColor,
          autoPostIncludeBrand: effectivePolicy.autoPostIncludeBrand,
          autoPostAiCaptionEnabled: effectivePolicy.autoPostAIcaptionEnabled,
        },
        salonId,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error('Error updating salon policy:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update policy',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
