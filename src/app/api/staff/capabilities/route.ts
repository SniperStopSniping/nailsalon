/**
 * Staff Capabilities API
 *
 * GET /api/staff/capabilities
 *
 * Returns effective modules and visibility settings for the logged-in staff member.
 * Used by staff UI to conditionally render features based on what's actually enabled.
 *
 * This endpoint is informational only - it should NEVER be gated by a module.
 * MODULE_DISABLED handling belongs in feature endpoints, not here.
 */

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  getEffectiveModuleEnabled,
  getEffectiveStaffVisibility,
} from '@/libs/featureGating';
import { requireStaffSession } from '@/libs/staffAuth';
import { salonSchema } from '@/models/Schema';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';
import type {
  StaffCapabilitiesResponse,
  StaffModules,
} from '@/types/staffCapabilities';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// GET /api/staff/capabilities
// =============================================================================

export async function GET(): Promise<Response> {
  // 1. Require valid staff session
  const auth = await requireStaffSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { salonId } = auth.session;

  try {
    // 2. Fetch salon features and settings
    const [salon] = await db
      .select({
        features: salonSchema.features,
        settings: salonSchema.settings,
      })
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);

    if (!salon) {
      return Response.json(
        { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
        { status: 404 },
      );
    }

    const features = salon.features as SalonFeatures | null;
    const settings = salon.settings as SalonSettings | null;

    // 3. Resolve effective modules (only staff-relevant ones)
    const modules: StaffModules = {
      scheduleOverrides: getEffectiveModuleEnabled({
        features,
        settings,
        module: 'scheduleOverrides',
      }),
      staffEarnings: getEffectiveModuleEnabled({
        features,
        settings,
        module: 'staffEarnings',
      }),
    };

    // 4. Resolve effective visibility
    const staffVisibility = getEffectiveStaffVisibility(features, settings);

    // 5. Map to response format (without "show" prefix for cleaner client API)
    const visibility = {
      clientPhone: staffVisibility.showClientPhone,
      clientEmail: staffVisibility.showClientEmail,
      clientFullName: staffVisibility.showClientFullName,
      appointmentPrice: staffVisibility.showAppointmentPrice,
      clientHistory: staffVisibility.showClientHistory,
      clientNotes: staffVisibility.showClientNotes,
      otherTechAppointments: staffVisibility.showOtherTechAppointments,
    };

    // 6. Return capabilities
    const response: StaffCapabilitiesResponse = {
      data: {
        modules,
        visibility,
      },
    };

    return Response.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Error fetching staff capabilities:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch capabilities' } },
      { status: 500 },
    );
  }
}
