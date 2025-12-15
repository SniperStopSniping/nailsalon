/**
 * Admin Module Settings API
 *
 * GET /api/admin/settings/modules - Get module toggle states and entitlements
 * PUT /api/admin/settings/modules - Update module toggle states
 *
 * Step 16.3 - Admin can enable/disable modules (only if entitled)
 */

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  getEntitledModules,
  getResolvedModules,
  MODULE_TO_ENTITLEMENT,
  resolveEntitlement,
} from '@/libs/featureGating';
import { salonSchema } from '@/models/Schema';
import type { ModuleKey, SalonFeatures, SalonSettings } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const updateSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  modules: z.object({
    smsReminders: z.boolean().optional(),
    referrals: z.boolean().optional(),
    rewards: z.boolean().optional(),
    scheduleOverrides: z.boolean().optional(),
    staffEarnings: z.boolean().optional(),
    clientFlags: z.boolean().optional(),
    clientBlocking: z.boolean().optional(),
    analyticsDashboard: z.boolean().optional(),
    utilization: z.boolean().optional(),
  }),
});

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

/**
 * Module reason for UI display (aligned with error codes):
 * - ENABLED: Module is entitled and admin has enabled it
 * - MODULE_DISABLED: Module is entitled but admin has disabled it (matches error code)
 * - UPGRADE_REQUIRED: Module is not entitled (matches error code)
 */
export type ModuleReason = 'ENABLED' | 'MODULE_DISABLED' | 'UPGRADE_REQUIRED';

// =============================================================================
// GET /api/admin/settings/modules - Get module toggle states
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = getQuerySchema.safeParse(queryParams);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug } = validated.data;

    // Verify admin has access to this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Get features and settings
    const features = salon.features as SalonFeatures | null;
    const settings = salon.settings as SalonSettings | null;

    // Compute entitled modules from features via MODULE_TO_ENTITLEMENT mapping
    const entitledModules = getEntitledModules(features);

    // Get resolved module states (with defaults applied, not raw DB nulls)
    const modules = getResolvedModules(settings);

    // Compute module reasons for cleaner UI logic (aligned with error codes)
    const moduleReasons: Record<ModuleKey, ModuleReason> = {} as Record<ModuleKey, ModuleReason>;
    for (const mod of Object.keys(MODULE_TO_ENTITLEMENT) as ModuleKey[]) {
      if (!entitledModules[mod]) {
        moduleReasons[mod] = 'UPGRADE_REQUIRED';
      } else if (!modules[mod]) {
        moduleReasons[mod] = 'MODULE_DISABLED';
      } else {
        moduleReasons[mod] = 'ENABLED';
      }
    }

    return Response.json({
      data: {
        modules,
        entitledModules,
        moduleReasons,
      },
    });
  } catch (err) {
    console.error('[Admin Modules GET] Error:', err);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch module settings',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/admin/settings/modules - Update module toggle states
// =============================================================================

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    // Validate request body
    const validated = updateSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, modules: moduleUpdates } = validated.data;

    // Verify admin has access to this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Get current features to check entitlements
    const features = salon.features as SalonFeatures | null;

    // Check that all modules being updated are entitled
    // Return 403 MODULE_DISABLED if trying to enable a non-entitled module
    for (const [moduleKey, value] of Object.entries(moduleUpdates)) {
      if (value === undefined) {
        continue;
      }

      const moduleId = moduleKey as ModuleKey;
      const mapping = MODULE_TO_ENTITLEMENT[moduleId];
      if (!mapping) {
        continue;
      }

      const [group, key] = mapping;
      const entitled = resolveEntitlement(features, group, key);

      if (!entitled && value === true) {
        // Trying to enable a module that is not entitled - requires plan upgrade
        return Response.json(
          {
            error: {
              code: 'UPGRADE_REQUIRED',
              message: 'Upgrade required',
            },
          } satisfies ErrorResponse,
          { status: 403 },
        );
      }
    }

    // Merge updates into existing settings.modules
    const existingSettings = (salon.settings as SalonSettings) ?? {};
    const existingModules = existingSettings.modules ?? {};

    const mergedModules = {
      ...existingModules,
      ...moduleUpdates,
    };

    // Update salon settings (merge, don't overwrite other settings)
    const updatedSettings: SalonSettings = {
      ...existingSettings,
      modules: mergedModules,
    };

    await db
      .update(salonSchema)
      .set({ settings: updatedSettings })
      .where(eq(salonSchema.id, salon.id));

    // Return updated state
    const entitledModules = getEntitledModules(features);
    const modules = getResolvedModules(updatedSettings);

    // Compute module reasons for cleaner UI logic (aligned with error codes)
    const moduleReasons: Record<ModuleKey, ModuleReason> = {} as Record<ModuleKey, ModuleReason>;
    for (const mod of Object.keys(MODULE_TO_ENTITLEMENT) as ModuleKey[]) {
      if (!entitledModules[mod]) {
        moduleReasons[mod] = 'UPGRADE_REQUIRED';
      } else if (!modules[mod]) {
        moduleReasons[mod] = 'MODULE_DISABLED';
      } else {
        moduleReasons[mod] = 'ENABLED';
      }
    }

    return Response.json({
      data: {
        modules,
        entitledModules,
        moduleReasons,
      },
    });
  } catch (err) {
    console.error('[Admin Modules PUT] Error:', err);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update module settings',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
