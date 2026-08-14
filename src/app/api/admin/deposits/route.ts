import { and, count, desc, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  needsAttentionPredicate,
  serializeDepositForRole,
} from '@/libs/deposits/depositLifecycle';
import {
  assertNoDevRoleBypass,
  requireDepositReadActor,
} from '@/libs/deposits/depositMoneyGuard';
import { appointmentDepositSchema } from '@/models/Schema';

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

type LookupName = 'depositId' | 'stripeRefundId' | 'stripePaymentIntentId';

async function loadExactLookup(
  salonId: string,
  name: LookupName,
  value: string | null,
) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const field = name === 'depositId'
    ? appointmentDepositSchema.id
    : name === 'stripeRefundId'
      ? appointmentDepositSchema.stripeRefundId
      : appointmentDepositSchema.stripePaymentIntentId;
  const [deposit] = await db
    .select()
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.salonId, salonId),
      eq(field, normalized),
    ))
    .limit(1);
  return deposit ?? null;
}

export async function GET(request: Request): Promise<Response> {
  const bypass = await assertNoDevRoleBypass();
  if (bypass) {
    return withPrivateNoStore(bypass);
  }

  try {
    const url = new URL(request.url);
    const access = await requireDepositReadActor({
      request,
      rateLimitKey: 'admin-deposits-read',
      salonSlug: url.searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return withPrivateNoStore(access.response);
    }

    const attention = needsAttentionPredicate(access.salon.id);
    const [needsAttention, [attentionCount], depositId, stripeRefundId, stripePaymentIntentId]
      = await Promise.all([
        db
          .select()
          .from(appointmentDepositSchema)
          .where(attention)
          .orderBy(desc(appointmentDepositSchema.updatedAt))
          .limit(100),
        db
          .select({ total: count() })
          .from(appointmentDepositSchema)
          .where(attention),
        loadExactLookup(access.salon.id, 'depositId', url.searchParams.get('depositId')),
        loadExactLookup(access.salon.id, 'stripeRefundId', url.searchParams.get('stripeRefundId')),
        loadExactLookup(
          access.salon.id,
          'stripePaymentIntentId',
          url.searchParams.get('stripePaymentIntentId'),
        ),
      ]);

    const role = access.admin.isSuperAdmin ? 'super_admin' : 'admin';
    const serialize = (deposit: typeof depositId) => deposit
      ? serializeDepositForRole(role, deposit)
      : null;
    return privateJson({
      needsAttention: needsAttention.map(deposit => serializeDepositForRole(role, deposit)),
      moreOmitted: Math.max(0, (attentionCount?.total ?? 0) - needsAttention.length),
      lookups: {
        depositId: serialize(depositId),
        stripeRefundId: serialize(stripeRefundId),
        stripePaymentIntentId: serialize(stripePaymentIntentId),
      },
    });
  } catch (error) {
    console.error('Error loading deposits:', error);
    return privateJson(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load deposits.',
        },
      },
      { status: 500 },
    );
  }
}
