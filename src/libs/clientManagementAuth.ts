import 'server-only';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import type { Salon } from '@/models/Schema';

export type ClientManagerActor = {
  id: string;
  role: 'owner' | 'admin';
};

export type ClientManagerGuard =
  | {
    ok: true;
    salon: Salon;
    actor: ClientManagerActor;
  }
  | {
    ok: false;
    response: Response;
  };

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Vary': 'Cookie',
      },
    },
  );
}

function withPrivateHeaders(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Vary', 'Cookie');
  return response;
}

/**
 * Production lifecycle mutations are activated only after migration 0061 and
 * the new application have both passed health checks. Preview/test remain on
 * by default so the exact release candidate can be exercised before rollout.
 */
export function clientLifecycleMutationsEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicit = environment.CLIENT_LIFECYCLE_MUTATIONS_ENABLED?.trim()
    .toLowerCase();
  if (explicit === 'true') {
    return true;
  }
  if (explicit === 'false') {
    return false;
  }
  if (environment.VERCEL_ENV) {
    return environment.VERCEL_ENV !== 'production';
  }
  return environment.NODE_ENV !== 'production';
}

/**
 * Owner/admin-only guard for client merge and lifecycle mutations.
 *
 * `requireAdminSalon` remains the source of tenant authorization. This
 * additional role check keeps a malformed/future read-only membership from
 * inheriting destructive client controls merely because it is a membership.
 */
export async function requireClientManagerSalon(
  salonSlug: string,
): Promise<ClientManagerGuard> {
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return { ok: false, response: withPrivateHeaders(error!) };
  }

  const admin = await getAdminSession();
  if (!admin) {
    return {
      ok: false,
      response: errorResponse(401, 'UNAUTHORIZED', 'Not authenticated'),
    };
  }

  if (admin.isSuperAdmin) {
    if (!clientLifecycleMutationsEnabled()) {
      return {
        ok: false,
        response: errorResponse(
          503,
          'CLIENT_LIFECYCLE_NOT_ENABLED',
          'Client merge and archive controls are not enabled yet.',
        ),
      };
    }
    return {
      ok: true,
      salon,
      actor: { id: admin.id, role: 'admin' },
    };
  }

  const membership = admin.salons.find(candidate => candidate.salonId === salon.id);
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return {
      ok: false,
      response: errorResponse(403, 'FORBIDDEN', 'Owner or admin access is required'),
    };
  }

  if (!clientLifecycleMutationsEnabled()) {
    return {
      ok: false,
      response: errorResponse(
        503,
        'CLIENT_LIFECYCLE_NOT_ENABLED',
        'Client merge and archive controls are not enabled yet.',
      ),
    };
  }

  return {
    ok: true,
    salon,
    actor: {
      id: admin.id,
      role: membership.role,
    },
  };
}
