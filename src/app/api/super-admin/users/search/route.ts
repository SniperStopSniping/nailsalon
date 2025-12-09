import { auth, clerkClient } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { isSuperAdmin } from '@/libs/super-admin';
import { salonSchema } from '@/models/Schema';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const searchQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.coerce.number().min(1).max(50).optional().default(10),
});

// =============================================================================
// HELPER: Verify Super Admin
// =============================================================================

async function verifySuperAdmin(): Promise<{ authorized: false; response: Response } | { authorized: true; userEmail: string }> {
  const { userId } = await auth();

  if (!userId) {
    return {
      authorized: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const userEmail = user.emailAddresses[0]?.emailAddress ?? '';

  if (!isSuperAdmin(userEmail)) {
    return {
      authorized: false,
      response: Response.json({ error: 'Forbidden - Super Admin access required' }, { status: 403 }),
    };
  }

  return { authorized: true, userEmail };
}

// =============================================================================
// GET /api/super-admin/users/search - Search Clerk users by email
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const authResult = await verifySuperAdmin();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    const validated = searchQuerySchema.safeParse(queryParams);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid query parameters', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { q, limit } = validated.data;

    // Search Clerk users by email
    const clerk = await clerkClient();
    const clerkUsers = await clerk.users.getUserList({
      query: q,
      limit,
    });

    // Get salons owned by these users
    const userIds = clerkUsers.data.map(u => u.id);
    const userSalons = userIds.length > 0
      ? await db
        .select({
          ownerClerkUserId: salonSchema.ownerClerkUserId,
          salonId: salonSchema.id,
          salonName: salonSchema.name,
          salonSlug: salonSchema.slug,
        })
        .from(salonSchema)
        .where(sql`${salonSchema.ownerClerkUserId} IN ${userIds}`)
      : [];

    // Build map of userId -> salons
    const userSalonMap = new Map<string, Array<{ id: string; name: string; slug: string }>>();
    for (const row of userSalons) {
      if (row.ownerClerkUserId) {
        const existing = userSalonMap.get(row.ownerClerkUserId) ?? [];
        existing.push({ id: row.salonId, name: row.salonName, slug: row.salonSlug });
        userSalonMap.set(row.ownerClerkUserId, existing);
      }
    }

    // Format response
    const data = clerkUsers.data.map(user => ({
      id: user.id,
      email: user.emailAddresses[0]?.emailAddress ?? '',
      name: user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : null,
      organizations: userSalonMap.get(user.id) ?? [],
    }));

    return Response.json({ data });
  } catch (error) {
    console.error('Error searching users:', error);
    return Response.json(
      { error: 'Failed to search users' },
      { status: 500 },
    );
  }
}
