import { getSalonById, getTechnicianById } from '@/libs/queries';
import { requireStaffApiSession } from '@/libs/staffApiGuards';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

// =============================================================================
// GET /api/staff/me - Get the current staff member's technician profile
// =============================================================================
// Uses server-side staff session auth
// No query params needed - reads from the validated session principal
// =============================================================================

export async function GET(): Promise<Response> {
  // DEV ONLY: Check for role override
  if (process.env.NODE_ENV !== 'production') {
    const { isDevModeServer, readDevRoleFromCookies, getMockStaffMeResponse }
      = await import('@/libs/devRole.server');
    if (isDevModeServer()) {
      const devRole = readDevRoleFromCookies();
      if (devRole === 'staff') {
        return Response.json(getMockStaffMeResponse(), {
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      // If a different dev role is set, return unauthorized
      if (devRole) {
        return Response.json(
          { error: { code: 'UNAUTHORIZED', message: 'Dev role mismatch' } },
          { status: 401 },
        );
      }
    }
  }

  try {
    const auth = await requireStaffApiSession();
    if (!auth.ok) {
      return auth.response;
    }

    const salon = await getSalonById(auth.session.salonId);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: `Salon not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    const technician = await getTechnicianById(auth.session.technicianId, salon.id);

    if (!technician) {
      return Response.json({
        data: {
          technician: null,
        },
      });
    }

    return Response.json({
      data: {
        technician: {
          id: technician.id,
          name: technician.name,
          email: technician.email,
          phone: technician.phone,
          avatarUrl: technician.avatarUrl,
          role: technician.role,
          currentStatus: technician.currentStatus,
        },
        salon: {
          id: salon.id,
          name: salon.name,
          slug: salon.slug,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching technician profile:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch technician profile',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
