import { auth, clerkClient } from '@clerk/nextjs/server';

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
  
  console.log('🔐 SUPER ADMIN CHECK:', {
    primaryEmail: primaryEmail.toLowerCase(),
    allowedEmails: allowed,
    isAllowed,
  });

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
