import { auth, clerkClient } from '@clerk/nextjs/server';

import { db } from '@/libs/DB';
import { salonAuditLogSchema, type AuditAction } from '@/models/Schema';

/**
 * Returns true if the current authenticated user is in SUPER_ADMIN_EMAILS.
 */
export async function isSuperAdmin(): Promise<boolean> {
  const { userId } = await auth();

  if (!userId) return false;

  const raw = process.env.SUPER_ADMIN_EMAILS || '';
  if (!raw) return false;

  const allowed = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return false;

  // Load user from Clerk to get email
  const client = await clerkClient();
  const user = await client.users.getUser(userId);

  const primaryEmail =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
      ?.emailAddress || user.emailAddresses[0]?.emailAddress;

  if (!primaryEmail) return false;

  const isAllowed = allowed.includes(primaryEmail.toLowerCase());
  return isAllowed;
}

/**
 * Use at the top of API routes. If not super admin, return 403 Response.
 * If super admin, returns null so you can continue.
 */
export async function requireSuperAdmin(): Promise<Response | null> {
  const ok = await isSuperAdmin();
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

/**
 * Get the current super admin user info (userId and email)
 */
export async function getSuperAdminInfo(): Promise<{ userId: string; email: string } | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const client = await clerkClient();
  const user = await client.users.getUser(userId);

  const primaryEmail =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
      ?.emailAddress || user.emailAddresses[0]?.emailAddress;

  return { userId, email: primaryEmail || '' };
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
  if (!adminInfo) return;

  await db.insert(salonAuditLogSchema).values({
    id: crypto.randomUUID(),
    salonId,
    action,
    performedBy: adminInfo.userId,
    performedByEmail: adminInfo.email,
    metadata: metadata || null,
  });
}
