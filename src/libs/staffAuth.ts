/**
 * Staff Authentication Module (Server-Only)
 *
 * Provides session validation and principal derivation for staff endpoints.
 * All authorization is server-enforced using cookies - NEVER trust client-passed IDs.
 */

import { cookies } from 'next/headers';

import { getSalonBySlug, getTechnicianByPhone } from '@/libs/queries';

// =============================================================================
// TYPES
// =============================================================================

export type StaffSession = {
  technicianId: string;
  technicianName: string;
  salonId: string;
  salonSlug: string;
  phone: string;
};

export type StaffAuthSuccess = {
  ok: true;
  session: StaffSession;
};

export type StaffAuthFailure = {
  ok: false;
  response: Response;
};

export type StaffAuthResult = StaffAuthSuccess | StaffAuthFailure;

// =============================================================================
// ERROR RESPONSES
// =============================================================================

function unauthorizedResponse(message = 'Staff authentication required'): Response {
  return Response.json(
    {
      error: {
        code: 'UNAUTHORIZED',
        message,
        reason: 'missing_or_invalid_session',
      },
    },
    { status: 401 },
  );
}

function notFoundResponse(message = 'Resource not found'): Response {
  return Response.json(
    {
      error: {
        code: 'NOT_FOUND',
        message,
        reason: 'resource_not_found',
      },
    },
    { status: 404 },
  );
}

// =============================================================================
// MAIN AUTH FUNCTION
// =============================================================================

/**
 * Require valid staff session and derive principal from cookies.
 *
 * SECURITY: This function derives technicianId and salonId from server-side
 * session cookies. NEVER accept these values from client query params or body.
 *
 * @returns StaffAuthResult - Either { ok: true, session } or { ok: false, response }
 */
export async function requireStaffSession(): Promise<StaffAuthResult> {
  // DEV ONLY: Check for role override
  if (process.env.NODE_ENV !== 'production') {
    const { isDevModeServer, readDevRoleFromCookies, getMockStaffMeResponse }
      = await import('@/libs/devRole.server');
    if (isDevModeServer()) {
      const devRole = readDevRoleFromCookies();
      if (devRole === 'staff') {
        const mockData = getMockStaffMeResponse();
        return {
          ok: true,
          session: {
            technicianId: mockData.data.technician.id,
            technicianName: mockData.data.technician.name,
            salonId: mockData.data.salon.id,
            salonSlug: mockData.data.salon.slug,
            phone: mockData.data.technician.phone,
          },
        };
      }
      // If a different dev role is set, return unauthorized
      if (devRole) {
        return { ok: false, response: unauthorizedResponse('Dev role mismatch') };
      }
    }
  }

  try {
    // 1. Read staff cookies
    const cookieStore = await cookies();
    const staffSession = cookieStore.get('staff_session');
    const staffPhone = cookieStore.get('staff_phone');
    const staffSalon = cookieStore.get('staff_salon');

    // 2. Verify all required cookies exist
    if (!staffSession?.value || !staffPhone?.value || !staffSalon?.value) {
      return { ok: false, response: unauthorizedResponse() };
    }

    // 3. Resolve salon from cookie (NOT from client input)
    const salon = await getSalonBySlug(staffSalon.value);
    if (!salon) {
      return { ok: false, response: notFoundResponse('Salon not found') };
    }

    // 4. Get technician by phone (scoped to salon)
    const technician = await getTechnicianByPhone(staffPhone.value, salon.id);
    if (!technician) {
      return { ok: false, response: notFoundResponse('Technician profile not found') };
    }

    // 5. Return validated session
    return {
      ok: true,
      session: {
        technicianId: technician.id,
        technicianName: technician.name,
        salonId: salon.id,
        salonSlug: salon.slug,
        phone: staffPhone.value,
      },
    };
  } catch (error) {
    console.error('Staff auth error:', error);
    return { ok: false, response: unauthorizedResponse('Authentication failed') };
  }
}

/**
 * Check if request has staff session cookies (without full validation).
 * Used to detect staff context vs admin context.
 */
export async function hasStaffSessionCookies(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const staffSession = cookieStore.get('staff_session');
    const staffPhone = cookieStore.get('staff_phone');
    const staffSalon = cookieStore.get('staff_salon');

    return Boolean(staffSession?.value && staffPhone?.value && staffSalon?.value);
  } catch {
    return false;
  }
}
