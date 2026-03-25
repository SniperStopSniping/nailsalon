/**
 * Staff Authentication Module (Server-Only)
 *
 * Provides session validation and principal derivation for staff endpoints.
 * All authorization is server-enforced using cookies - NEVER trust client-passed IDs.
 */

import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { db } from '@/libs/DB';
import {
  salonSchema,
  staffSessionSchema,
  technicianSchema,
} from '@/models/Schema';

export const STAFF_SESSION_COOKIE = 'staff_session';
export const STAFF_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

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

export async function createStaffSession(args: {
  salonId: string;
  technicianId: string;
}): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + STAFF_SESSION_DURATION_MS);

  await db.insert(staffSessionSchema).values({
    id: sessionId,
    technicianId: args.technicianId,
    salonId: args.salonId,
    expiresAt,
  });

  return sessionId;
}

export async function deleteStaffSession(sessionId: string): Promise<void> {
  await db.delete(staffSessionSchema).where(eq(staffSessionSchema.id, sessionId));
}

export async function setStaffSessionCookies(args: {
  sessionId: string;
}): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(STAFF_SESSION_COOKIE, args.sessionId, {
    ...COOKIE_OPTIONS,
    maxAge: STAFF_SESSION_DURATION_MS / 1000,
  });

  for (const legacyCookie of ['staff_phone', 'staff_name', 'staff_salon']) {
    cookieStore.set(legacyCookie, '', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });
  }
}

export async function clearStaffSessionCookies(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(STAFF_SESSION_COOKIE, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });

  cookieStore.set('staff_phone', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  cookieStore.set('staff_name', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  cookieStore.set('staff_salon', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
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
    // 1. Read session cookie
    const cookieStore = await cookies();
    const staffSession = cookieStore.get(STAFF_SESSION_COOKIE);

    // 2. Verify session exists
    if (!staffSession?.value) {
      return { ok: false, response: unauthorizedResponse() };
    }

    // 3. Resolve staff session from DB
    const [session] = await db
      .select()
      .from(staffSessionSchema)
      .where(
        and(
          eq(staffSessionSchema.id, staffSession.value),
          gt(staffSessionSchema.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      return { ok: false, response: unauthorizedResponse() };
    }

    // 4. Resolve salon from session
    const [salon] = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, session.salonId))
      .limit(1);
    if (!salon) {
      return { ok: false, response: notFoundResponse('Salon not found') };
    }

    // 5. Resolve technician from session
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, session.technicianId),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);
    if (!technician) {
      return { ok: false, response: notFoundResponse('Technician profile not found') };
    }
    if (!technician.phone) {
      return { ok: false, response: notFoundResponse('Technician phone not found') };
    }

    db.update(staffSessionSchema)
      .set({ lastSeenAt: new Date() })
      .where(eq(staffSessionSchema.id, session.id))
      .catch(() => {});

    // 6. Return validated session
    return {
      ok: true,
      session: {
        technicianId: technician.id,
        technicianName: technician.name,
        salonId: salon.id,
        salonSlug: salon.slug,
        phone: technician.phone,
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
    const staffSession = cookieStore.get(STAFF_SESSION_COOKIE);

    return Boolean(staffSession?.value);
  } catch {
    return false;
  }
}
