/**
 * Super Admin Helper Functions
 *
 * Provides authorization checks and audit logging for super admin operations.
 * Uses the new phone-based admin auth system.
 */

import {
  type AdminGuardResult,
  getAdminSession,
  requireSuperAdmin as requireSuperAdminFromAuth,
} from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { type AuditAction, salonAuditLogSchema } from '@/models/Schema';

/**
 * Returns true if the current user is a super admin.
 * Uses the new phone-based admin auth system.
 */
export async function isSuperAdmin(): Promise<boolean> {
  const admin = await getAdminSession();
  return admin?.isSuperAdmin ?? false;
}

/**
 * Use at the top of API routes. If not super admin, return 403 Response.
 * If super admin, returns null so you can continue.
 *
 * @deprecated Use requireSuperAdmin() from adminAuth.ts which returns discriminated union
 */
export async function requireSuperAdmin(): Promise<Response | null> {
  const guard = await requireSuperAdminFromAuth();
  if (!guard.ok) {
    return guard.response;
  }
  return null;
}

/**
 * New version that returns discriminated union
 */
export async function requireSuperAdminGuard(): Promise<AdminGuardResult> {
  return requireSuperAdminFromAuth();
}

/**
 * Get the current super admin user info
 */
export async function getSuperAdminInfo(): Promise<{
  userId: string;
  phone: string;
  name: string | null;
} | null> {
  const admin = await getAdminSession();

  if (!admin || !admin.isSuperAdmin) {
    return null;
  }

  return {
    userId: admin.id,
    phone: admin.phoneE164,
    name: admin.name,
  };
}

/**
 * Log an audit action for a salon
 */
export async function logAuditAction(
  salonId: string,
  action: AuditAction,
  metadata?: {
    previousValue?: unknown;
    newValue?: unknown;
    field?: string;
    details?: string;
  },
): Promise<void> {
  const adminInfo = await getSuperAdminInfo();
  if (!adminInfo) {
    return;
  }

  await db.insert(salonAuditLogSchema).values({
    id: crypto.randomUUID(),
    salonId,
    action,
    performedBy: adminInfo.userId,
    performedByEmail: adminInfo.phone, // Using phone instead of email now
    metadata: metadata || null,
  });
}
