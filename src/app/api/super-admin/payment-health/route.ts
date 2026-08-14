import { requireSuperAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { loadDepositHealth } from '@/libs/deposits/depositLifecycle';
import {
  assertNoDevRoleBypass,
  requireDepositReadActor,
} from '@/libs/deposits/depositMoneyGuard';
import { getClientIp } from '@/libs/rateLimit';

export const dynamic = 'force-dynamic';

const PRIVATE_NO_STORE = 'private, no-store, max-age=0';

function privateJson(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('Cache-Control', PRIVATE_NO_STORE);
  return Response.json(body, { ...init, headers });
}

function withPrivateNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', PRIVATE_NO_STORE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Request): Promise<Response> {
  const bypass = await assertNoDevRoleBypass();
  if (bypass) {
    return withPrivateNoStore(bypass);
  }

  try {
    const readAccess = await requireDepositReadActor({
      request,
      rateLimitKey: 'super-admin-payment-health',
      crossSalon: true,
    });
    if (!readAccess.ok) {
      return withPrivateNoStore(readAccess.response);
    }

    const access = await requireSuperAdmin();
    if (!access.ok) {
      return withPrivateNoStore(access.response);
    }

    void logAuditEvent({
      actorType: 'super_admin',
      actorId: access.admin.id,
      action: 'payment_health_viewed',
      entityType: 'payment_health',
      entityId: 'cross_salon',
      metadata: { crossSalon: true },
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    return privateJson(await loadDepositHealth(null));
  } catch (error) {
    console.error('Error loading deposit payment health:', error);
    return privateJson(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load payment health.',
        },
      },
      { status: 500 },
    );
  }
}
