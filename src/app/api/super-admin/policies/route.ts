/**
 * Super Admin Policies API Route
 *
 * GET - Get current super admin policy
 * PUT - Update super admin policy
 *
 * Protected by requireSuperAdmin().
 */

import {
  getSuperAdminPolicy,
  upsertSuperAdminPolicy,
} from '@/core/appointments/policyRepo';
import {
  normalizeSuperAdminPolicyInput,
  SuperAdminPolicyInputSchema,
} from '@/core/appointments/policySchemas';
import { requireSuperAdmin } from '@/libs/adminAuth';

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
// GET /api/super-admin/policies
// =============================================================================

export async function GET(): Promise<Response> {
  // Auth check
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const policy = await getSuperAdminPolicy();

    return Response.json({
      data: {
        policy: {
          requireBeforePhotoToStart: policy.requireBeforePhotoToStart,
          requireAfterPhotoToFinish: policy.requireAfterPhotoToFinish,
          requireAfterPhotoToPay: policy.requireAfterPhotoToPay,
          autoPostEnabled: policy.autoPostEnabled,
          autoPostAiCaptionEnabled: policy.autoPostAiCaptionEnabled,
        },
        isDefault: policy.isDefault,
        updatedAt: policy.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error('Error fetching super admin policy:', error);
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
// PUT /api/super-admin/policies
// =============================================================================

export async function PUT(request: Request): Promise<Response> {
  // Auth check
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  try {
    // Parse request body
    const body = await request.json();

    // Validate with Zod
    const parsed = SuperAdminPolicyInputSchema.safeParse(body);
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
    const normalized = normalizeSuperAdminPolicyInput(parsed.data);

    // Upsert policy
    const updated = await upsertSuperAdminPolicy(undefined, normalized);

    return Response.json({
      data: {
        policy: {
          requireBeforePhotoToStart: updated.requireBeforePhotoToStart,
          requireAfterPhotoToFinish: updated.requireAfterPhotoToFinish,
          requireAfterPhotoToPay: updated.requireAfterPhotoToPay,
          autoPostEnabled: updated.autoPostEnabled,
          autoPostAiCaptionEnabled: updated.autoPostAiCaptionEnabled,
        },
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error('Error updating super admin policy:', error);
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
