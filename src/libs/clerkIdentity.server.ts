import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';

function isClerkNotFoundError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      errors?: Array<{ code?: unknown }>;
      cause?: unknown;
    };
    if (candidate.status === 404 || candidate.statusCode === 404 || candidate.code === 'resource_not_found') {
      return true;
    }
    if (candidate.errors?.some(item => item.code === 'resource_not_found')) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * Checks whether a previously stored Clerk identity is absent from the Clerk
 * instance currently configured on the server. Unexpected provider failures
 * are rethrown so callers fail closed instead of taking over a live identity.
 */
export async function isClerkUserMissing(clerkUserId: string): Promise<boolean> {
  try {
    const client = await clerkClient();
    await client.users.getUser(clerkUserId);
    return false;
  } catch (error) {
    if (isClerkNotFoundError(error)) {
      return true;
    }
    throw error;
  }
}
