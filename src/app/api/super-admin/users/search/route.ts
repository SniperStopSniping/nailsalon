import { clerkClient } from '@clerk/nextjs/server';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/superAdmin';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const searchQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required'),
});

// =============================================================================
// GET /api/super-admin/users/search - Search Clerk users
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    const validated = searchQuerySchema.safeParse(queryParams);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid query parameters', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { q } = validated.data;

    // Search users in Clerk
    const client = await clerkClient();
    const users = await client.users.getUserList({
      query: q,
      limit: 10,
    });

    // Format response
    const items = users.data.map((user) => {
      const primaryEmail =
        user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
          ?.emailAddress || user.emailAddresses[0]?.emailAddress;

      return {
        id: user.id,
        email: primaryEmail || null,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      };
    });

    return Response.json({ items });
  } catch (error) {
    console.error('Error searching users:', error);
    return Response.json(
      { error: 'Failed to search users' },
      { status: 500 },
    );
  }
}
