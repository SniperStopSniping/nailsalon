/**
 * DEV ONLY - Server-safe dev role helpers
 *
 * This module provides server-side utilities for the dev role switcher.
 * It reads role override from cookies and provides mock session factories.
 *
 * IMPORTANT: This code is guarded by NODE_ENV checks and should be
 * dynamically imported only in dev mode to ensure tree-shaking in prod.
 */

import { cookies } from 'next/headers';

import type { AdminWithSalons } from './adminAuth';

// =============================================================================
// TYPES & CONSTANTS
// =============================================================================

export type DevRole = 'super_admin' | 'admin' | 'staff' | 'client';

export const DEV_COOKIE_NAME = '__dev_role_override';

export const ALLOWED_ROLES = new Set<DevRole>([
  'super_admin',
  'admin',
  'staff',
  'client',
]);

// =============================================================================
// DEV SUPER ADMIN ID HELPERS
// =============================================================================

// Warning flag to only log once per server instance
let devSuperAdminWarningLogged = false;

/**
 * Get the dev super admin ID from env, or fallback with warning
 */
function getDevSuperAdminId(): string {
  const envId = process.env.DEV_SUPER_ADMIN_ID;
  if (envId) {
    return envId;
  }

  if (!devSuperAdminWarningLogged) {
    console.warn(
      '\n⚠️  DEV_SUPER_ADMIN_ID is not set!\n'
      + 'FK-dependent operations (salon creation, invites) will fail.\n'
      + 'To fix:\n'
      + '1. Create a real admin_user row with isSuperAdmin=true:\n'
      + '   INSERT INTO admin_user (id, phone_e164, name, is_super_admin)\n'
      + '   VALUES (\'dev-sa-\' || gen_random_uuid(), \'+15555550001\', \'Dev Super Admin\', true)\n'
      + '   RETURNING id;\n'
      + '2. Add DEV_SUPER_ADMIN_ID=<that_id> to .env.local\n'
      + '3. Restart the dev server\n',
    );
    devSuperAdminWarningLogged = true;
  }

  return 'dev-super-admin';
}

/**
 * Check if a real dev super admin ID is configured
 */
export function hasRealDevSuperAdminId(): boolean {
  return Boolean(process.env.DEV_SUPER_ADMIN_ID);
}

// =============================================================================
// DEV MODE CHECK
// =============================================================================

/**
 * Check if dev mode is enabled (server-side)
 */
export function isDevModeServer(): boolean {
  return (
    process.env.NODE_ENV !== 'production'
    || process.env.NEXT_PUBLIC_DEV_MODE === 'true'
  );
}

// =============================================================================
// COOKIE READING
// =============================================================================

/**
 * Read dev role override from cookies
 * Returns null if no valid role is set
 *
 * NOTE: cookies() is synchronous in Next.js App Router
 */
export function readDevRoleFromCookies(): DevRole | null {
  if (!isDevModeServer()) {
    return null;
  }

  try {
    const cookieStore = cookies();
    const value = cookieStore.get(DEV_COOKIE_NAME)?.value;

    if (value && ALLOWED_ROLES.has(value as DevRole)) {
      return value as DevRole;
    }
  } catch {
    // cookies() can throw in some contexts (e.g., during static generation)
  }

  return null;
}

// =============================================================================
// MOCK SESSION FACTORIES
// =============================================================================

/**
 * Mock response for /api/admin/auth/me
 * Must match the exact shape returned by that endpoint
 */
export function getMockAdminMeResponse(role: 'super_admin' | 'admin') {
  if (role === 'super_admin') {
    return {
      user: {
        id: getDevSuperAdminId(),
        phone: '+15555550001',
        name: 'Dev Super Admin',
        email: 'dev-super@test.local',
        isSuperAdmin: true,
        profileComplete: true,
        salons: [],
      },
    };
  }

  // admin
  return {
    user: {
      id: 'dev-admin',
      phone: '+15555550002',
      name: 'Dev Admin',
      email: 'dev-admin@test.local',
      isSuperAdmin: false,
      profileComplete: true,
      salons: [
        {
          id: 'demo',
          slug: 'demo-salon',
          name: 'Demo Salon',
          role: 'owner',
        },
      ],
    },
  };
}

/**
 * Mock response for /api/staff/me
 * Must match the exact shape returned by that endpoint
 */
export function getMockStaffMeResponse() {
  return {
    data: {
      technician: {
        id: 'dev-staff',
        name: 'Dev Technician',
        email: null,
        phone: '+15555550003',
        avatarUrl: null,
        role: 'technician',
        currentStatus: 'available',
      },
      salon: {
        id: 'demo',
        slug: 'demo-salon',
        name: 'Demo Salon',
      },
    },
  };
}

/**
 * Mock response for /api/auth/validate-session
 * Must match the exact shape returned by that endpoint
 */
export function getMockValidateSessionResponse() {
  return {
    valid: true,
    phone: '+15555550004',
  };
}

/**
 * Mock AdminWithSalons for getAdminSession()
 * Must match the AdminWithSalons type from adminAuth.ts
 */
export function getMockAdminSession(
  role: 'super_admin' | 'admin',
): AdminWithSalons {
  if (role === 'super_admin') {
    return {
      id: getDevSuperAdminId(),
      phoneE164: '+15555550001',
      name: 'Dev Super Admin',
      email: 'dev-super@test.local',
      emailVerifiedAt: null,
      isSuperAdmin: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      salons: [],
    };
  }

  // admin
  return {
    id: 'dev-admin',
    phoneE164: '+15555550002',
    name: 'Dev Admin',
    email: 'dev-admin@test.local',
    emailVerifiedAt: null,
    isSuperAdmin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    salons: [
      {
        salonId: 'demo',
        salonSlug: 'demo-salon',
        salonName: 'Demo Salon',
        role: 'owner',
      },
    ],
  };
}
