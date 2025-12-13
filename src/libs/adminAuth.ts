/**
 * Admin Authentication Module
 *
 * Provides session management and authorization helpers for admin/super-admin.
 * Uses server-side sessions stored in DB with a single HttpOnly cookie.
 */

import { cookies } from 'next/headers';
import { eq, and, gt, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  adminUserSchema,
  adminSessionSchema,
  adminInviteSchema,
  adminSalonMembershipSchema,
  salonSchema,
  type AdminUser,
  type AdminInviteRole,
} from '@/models/Schema';

// =============================================================================
// CONSTANTS
// =============================================================================

export const ADMIN_SESSION_COOKIE = 'n5_admin_session';
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 365; // 1 year

// Cookie options - must be identical for set and clear
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

// =============================================================================
// TYPES
// =============================================================================

export interface SalonMembership {
  salonId: string;
  salonSlug: string;
  salonName: string;
  role: string;
}

export interface AdminWithSalons extends AdminUser {
  salons: SalonMembership[];
}

// Discriminated union for guard results
export type AdminGuardSuccess = { ok: true; admin: AdminWithSalons };
export type AdminGuardFailure = { ok: false; response: Response };
export type AdminGuardResult = AdminGuardSuccess | AdminGuardFailure;

// =============================================================================
// PHONE FORMATTING
// =============================================================================

/**
 * Format phone number to E.164 format (+1XXXXXXXXXX)
 */
export function formatPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  // Already has country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // US number (10 digits)
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Already E164 format
  if (phone.startsWith('+1') && phone.length === 12) {
    return phone;
  }

  throw new Error('Invalid phone number format');
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone: string): boolean {
  try {
    formatPhoneE164(phone);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Get current admin from session cookie
 * Returns null if not logged in or session expired
 */
export async function getAdminSession(): Promise<AdminWithSalons | null> {
  // DEV ONLY: Check for role override
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEV_MODE === 'true') {
    const { isDevModeServer, readDevRoleFromCookies, getMockAdminSession } = await import('./devRole.server');
    if (isDevModeServer()) {
      const devRole = readDevRoleFromCookies();
      if (devRole === 'super_admin' || devRole === 'admin') {
        return getMockAdminSession(devRole);
      }
      // If a different dev role is set, return null (not authorized as admin)
      if (devRole) {
        return null;
      }
    }
  }

  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

    if (!sessionId) {
      return null;
    }

    // Lookup session (check not expired)
    const [session] = await db
      .select()
      .from(adminSessionSchema)
      .where(
        and(
          eq(adminSessionSchema.id, sessionId),
          gt(adminSessionSchema.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      return null;
    }

    // Lookup admin user
    const [admin] = await db
      .select()
      .from(adminUserSchema)
      .where(eq(adminUserSchema.id, session.adminId))
      .limit(1);

    if (!admin) {
      return null;
    }

    // Lookup salon memberships
    const memberships = await db
      .select({
        salonId: adminSalonMembershipSchema.salonId,
        role: adminSalonMembershipSchema.role,
        salonSlug: salonSchema.slug,
        salonName: salonSchema.name,
      })
      .from(adminSalonMembershipSchema)
      .innerJoin(salonSchema, eq(adminSalonMembershipSchema.salonId, salonSchema.id))
      .where(eq(adminSalonMembershipSchema.adminId, admin.id));

    // Optionally update lastSeenAt (don't await, fire and forget)
    db.update(adminSessionSchema)
      .set({ lastSeenAt: new Date() })
      .where(eq(adminSessionSchema.id, sessionId))
      .catch(() => {}); // Ignore errors

    return {
      ...admin,
      salons: memberships.map((m) => ({
        salonId: m.salonId,
        salonSlug: m.salonSlug,
        salonName: m.salonName,
        role: m.role,
      })),
    };
  } catch (error) {
    console.error('Error getting admin session:', error);
    return null;
  }
}

/**
 * Create a new admin session
 * Returns the session ID to be stored in cookie
 */
export async function createAdminSession(adminId: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(adminSessionSchema).values({
    id: sessionId,
    adminId,
    expiresAt,
  });

  return sessionId;
}

/**
 * Delete an admin session
 */
export async function deleteAdminSession(sessionId: string): Promise<void> {
  await db.delete(adminSessionSchema).where(eq(adminSessionSchema.id, sessionId));
}

// =============================================================================
// AUTHORIZATION GUARDS
// =============================================================================

/**
 * Require admin access for a specific salon
 * Returns discriminated union: { ok: true, admin } or { ok: false, response }
 */
export async function requireAdmin(salonId: string): Promise<AdminGuardResult> {
  const admin = await getAdminSession();

  if (!admin) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  // Super admins have access to all salons
  if (admin.isSuperAdmin) {
    return { ok: true, admin };
  }

  // Check if admin has membership for this salon
  const hasMembership = admin.salons.some((s) => s.salonId === salonId);

  if (!hasMembership) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  return { ok: true, admin };
}

/**
 * Require super admin access
 * Returns discriminated union: { ok: true, admin } or { ok: false, response }
 */
export async function requireSuperAdmin(): Promise<AdminGuardResult> {
  const admin = await getAdminSession();

  if (!admin) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  if (!admin.isSuperAdmin) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  return { ok: true, admin };
}

// =============================================================================
// INVITE & BOOTSTRAP CHECKS
// =============================================================================

/**
 * Check if a phone number can receive admin OTP
 * Returns true if:
 * - Phone belongs to existing admin user
 * - Phone has a valid (unused, unexpired) invite
 * - Phone is bootstrap phone and no super admins exist
 */
export async function canReceiveAdminOtp(phoneE164: string): Promise<boolean> {
  // Check 1: Existing admin user
  const [existingAdmin] = await db
    .select({ id: adminUserSchema.id })
    .from(adminUserSchema)
    .where(eq(adminUserSchema.phoneE164, phoneE164))
    .limit(1);

  if (existingAdmin) {
    return true;
  }

  // Check 2: Valid invite
  const [validInvite] = await db
    .select({ id: adminInviteSchema.id })
    .from(adminInviteSchema)
    .where(
      and(
        eq(adminInviteSchema.phoneE164, phoneE164),
        isNull(adminInviteSchema.usedAt),
        gt(adminInviteSchema.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (validInvite) {
    return true;
  }

  // Check 3: Bootstrap phone
  const bootstrapPhone = process.env.SUPER_ADMIN_BOOTSTRAP_PHONE;
  if (bootstrapPhone && phoneE164 === bootstrapPhone) {
    // Check if any super admins exist
    const [existingSuperAdmin] = await db
      .select({ id: adminUserSchema.id })
      .from(adminUserSchema)
      .where(eq(adminUserSchema.isSuperAdmin, true))
      .limit(1);

    if (!existingSuperAdmin) {
      return true;
    }
  }

  return false;
}

/**
 * Check if bootstrap should activate
 * Returns true if phone matches bootstrap env AND no super admins exist
 */
export async function shouldBootstrap(phoneE164: string): Promise<boolean> {
  const bootstrapPhone = process.env.SUPER_ADMIN_BOOTSTRAP_PHONE;
  
  if (!bootstrapPhone || phoneE164 !== bootstrapPhone) {
    return false;
  }

  const [existingSuperAdmin] = await db
    .select({ id: adminUserSchema.id })
    .from(adminUserSchema)
    .where(eq(adminUserSchema.isSuperAdmin, true))
    .limit(1);

  return !existingSuperAdmin;
}

/**
 * Get valid invite for a phone number
 */
export async function getValidInvite(phoneE164: string): Promise<{
  id: string;
  salonId: string | null;
  role: AdminInviteRole;
} | null> {
  const [invite] = await db
    .select({
      id: adminInviteSchema.id,
      salonId: adminInviteSchema.salonId,
      role: adminInviteSchema.role,
    })
    .from(adminInviteSchema)
    .where(
      and(
        eq(adminInviteSchema.phoneE164, phoneE164),
        isNull(adminInviteSchema.usedAt),
        gt(adminInviteSchema.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return invite ? { ...invite, role: invite.role as AdminInviteRole } : null;
}

/**
 * Get existing admin user by phone
 */
export async function getAdminByPhone(phoneE164: string): Promise<AdminUser | null> {
  const [admin] = await db
    .select()
    .from(adminUserSchema)
    .where(eq(adminUserSchema.phoneE164, phoneE164))
    .limit(1);

  return admin ?? null;
}

// =============================================================================
// ADMIN USER MANAGEMENT
// =============================================================================

/**
 * Create admin user
 */
export async function createAdminUser(params: {
  phoneE164: string;
  name?: string;
  isSuperAdmin?: boolean;
}): Promise<AdminUser> {
  const id = crypto.randomUUID();

  const [admin] = await db
    .insert(adminUserSchema)
    .values({
      id,
      phoneE164: params.phoneE164,
      name: params.name ?? null,
      isSuperAdmin: params.isSuperAdmin ?? false,
    })
    .returning();

  return admin!;
}

/**
 * Create salon membership for admin
 */
export async function createAdminMembership(params: {
  adminId: string;
  salonId: string;
  role?: string;
}): Promise<void> {
  await db.insert(adminSalonMembershipSchema).values({
    adminId: params.adminId,
    salonId: params.salonId,
    role: params.role ?? 'admin',
  });
}

/**
 * Mark invite as used
 */
export async function markInviteUsed(inviteId: string): Promise<void> {
  await db
    .update(adminInviteSchema)
    .set({ usedAt: new Date() })
    .where(eq(adminInviteSchema.id, inviteId));
}

/**
 * Get admin with their salon memberships
 */
export async function getAdminWithSalons(adminId: string): Promise<AdminWithSalons | null> {
  const [admin] = await db
    .select()
    .from(adminUserSchema)
    .where(eq(adminUserSchema.id, adminId))
    .limit(1);

  if (!admin) {
    return null;
  }

  const memberships = await db
    .select({
      salonId: adminSalonMembershipSchema.salonId,
      role: adminSalonMembershipSchema.role,
      salonSlug: salonSchema.slug,
      salonName: salonSchema.name,
    })
    .from(adminSalonMembershipSchema)
    .innerJoin(salonSchema, eq(adminSalonMembershipSchema.salonId, salonSchema.id))
    .where(eq(adminSalonMembershipSchema.adminId, admin.id));

  return {
    ...admin,
    salons: memberships.map((m) => ({
      salonId: m.salonId,
      salonSlug: m.salonSlug,
      salonName: m.salonName,
      role: m.role,
    })),
  };
}

// =============================================================================
// BACKWARD COMPATIBILITY (for existing API routes)
// =============================================================================

import { getSalonBySlug } from '@/libs/queries';
import type { Salon } from '@/models/Schema';

/**
 * Legacy helper for existing admin API routes
 * Verifies admin session and returns salon
 * 
 * @deprecated Use requireAdmin(salonId) instead
 */
export async function requireAdminSalon(
  salonSlug: string,
): Promise<{ error: Response | null; salon: Salon | null }> {
  // Get salon first
  const salon = await getSalonBySlug(salonSlug);
  if (!salon) {
    return {
      error: new Response(
        JSON.stringify({ error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
      salon: null,
    };
  }

  // Check admin auth
  const guard = await requireAdmin(salon.id);
  if (!guard.ok) {
    return { error: guard.response, salon: null };
  }

  return { error: null, salon };
}
