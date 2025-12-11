import 'server-only';

import { auth } from '@clerk/nextjs/server';

import { getSalonBySlug, getSalonBySlugAndOwnerUserId } from '@/libs/queries';
import type { Salon } from '@/models/Schema';

/**
 * Admin Auth Helper
 *
 * Verifies that the current user is authenticated AND owns the specified salon.
 * Use this in all admin API routes to ensure proper multi-tenant isolation.
 *
 * Note: For salons without an owner set (ownerClerkUserId is null), any authenticated
 * user can access. This supports development and migration scenarios. In production,
 * ensure all salons have owners assigned.
 *
 * @param salonSlug - The salon slug from the request
 * @returns Object with either { error: Response, salon: null } or { error: null, salon: Salon }
 *
 * @example
 * export async function GET(req: Request) {
 *   const salonSlug = new URL(req.url).searchParams.get('salonSlug');
 *   if (!salonSlug) return Response.json({ error: 'Missing salonSlug' }, { status: 400 });
 *
 *   const { error, salon } = await requireAdminSalon(salonSlug);
 *   if (error || !salon) return error!;
 *
 *   // Use salon.id for all DB queries from here on
 * }
 */
export async function requireAdminSalon(salonSlug: string): Promise<
  | { error: Response; salon: null }
  | { error: null; salon: Salon }
> {
  const { userId } = await auth();

  if (!userId) {
    return {
      error: Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      ),
      salon: null,
    };
  }

  // First, try to find salon by slug and owner
  let salon = await getSalonBySlugAndOwnerUserId(salonSlug, userId);

  // If not found, check if salon exists but has no owner set (dev/migration scenario)
  if (!salon) {
    const unownedSalon = await getSalonBySlug(salonSlug);
    
    // Allow access if salon exists but has no owner assigned yet
    // This supports development and gradual migration to ownership model
    if (unownedSalon && !unownedSalon.ownerClerkUserId) {
      console.warn(
        `[adminAuth] Salon "${salonSlug}" has no owner set. ` +
        `Allowing access for authenticated user ${userId}. ` +
        `Set ownerClerkUserId in production.`
      );
      salon = unownedSalon;
    }
  }

  if (!salon) {
    return {
      error: Response.json(
        { error: { code: 'FORBIDDEN', message: 'You do not have access to this salon' } },
        { status: 403 },
      ),
      salon: null,
    };
  }

  return { error: null, salon };
}
