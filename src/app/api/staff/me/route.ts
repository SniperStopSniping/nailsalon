import { cookies } from 'next/headers';

import { getSalonBySlug, getTechnicianByPhone } from '@/libs/queries';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// =============================================================================
// GET /api/staff/me - Get the current staff member's technician profile
// =============================================================================
// Uses cookie-based auth (staff_phone + staff_salon cookies)
// No query params needed - reads from cookies set during staff login
// =============================================================================

export async function GET(): Promise<Response> {
  try {
    // 1. Read staff cookies
    const cookieStore = await cookies();
    const staffSession = cookieStore.get('staff_session');
    const staffPhone = cookieStore.get('staff_phone');
    const staffSalon = cookieStore.get('staff_salon');

    // 2. Verify session exists
    if (!staffSession?.value || !staffPhone?.value || !staffSalon?.value) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Not logged in. Please sign in first.',
          },
        } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    // 3. Resolve salon
    const salon = await getSalonBySlug(staffSalon.value);
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

    // 4. Get technician by phone
    const technician = await getTechnicianByPhone(staffPhone.value, salon.id);

    if (!technician) {
      return Response.json({
        data: {
          technician: null,
        },
      });
    }

    // 5. Return technician info
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
