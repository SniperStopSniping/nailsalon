/**
 * Locally unlink a salon from its connected Stripe account.
 *
 * POST /api/integrations/stripe-connect/disconnect
 * Body: { salonId, reason }
 *
 * LOCAL UNLINK ONLY. The platform cannot reject a Standard-equivalent account —
 * the salon keeps its Stripe account, its dashboard and its funds. That is also
 * why the revocation cause is `revoked_local` and not `deauthorized`: later PRs
 * branch on the difference, because a local unlink must NOT freeze settlement or
 * refund of already-captured deposits, while a real deauthorization must.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { type DepositsReadinessSqlHandle, isDepositsSchemaReady } from '@/libs/depositsSchema';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { getLiveBinding, revokeBinding } from '@/libs/stripeConnect/binding';
// THE SINGLE SANCTIONED RUNTIME IMPORT of this symbol. D2 writes no
// `appointment_deposit` row and updates none; this is the one read, and it goes
// through the mapped Drizzle schema rather than raw SQL on purpose — raw SQL here
// would evade exactly the mapped-schema type discipline the mapping exists to buy.
import { appointmentDepositSchema } from '@/models/Schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The two NON-TERMINAL members of the frozen six-value deposit status
 * vocabulary. Identical to the set the partial one-active unique index uses.
 */
const NON_TERMINAL_DEPOSIT_STATUSES = ['checkout_created', 'paid'] as const;

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit('stripe-connect/disconnect', ip, 'BILLING');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfterMs);
  }

  let salonId: string | undefined;
  let reason: string | undefined;
  try {
    const body = await request.json() as { salonId?: string; reason?: string };
    salonId = body?.salonId;
    reason = body?.reason;
  } catch {
    return errorResponse('INVALID_INPUT', 'salonId is required', 400);
  }
  if (!salonId) {
    return errorResponse('INVALID_INPUT', 'salonId is required', 400);
  }

  const auth = await requireAdmin(salonId);
  if (!auth.ok) {
    return auth.response;
  }

  if (!await isDepositsSchemaReady(db as DepositsReadinessSqlHandle)) {
    return errorResponse(
      'DEPOSITS_SCHEMA_NOT_PROVISIONED',
      'Deposits are not available yet.',
      503,
    );
  }

  // Returns zero rows today — D4 is the first writer of this table. Specified now
  // so later PRs inherit the guard rather than discovering they needed it.
  const [inFlight] = await db
    .select({ count: sql<number>`count(*)` })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.salonId, salonId),
      inArray(appointmentDepositSchema.status, [...NON_TERMINAL_DEPOSIT_STATUSES]),
    ));

  if (Number(inFlight?.count ?? 0) > 0) {
    return errorResponse(
      'DEPOSITS_IN_FLIGHT',
      'Finish or cancel outstanding deposits before disconnecting.',
      409,
    );
  }

  const binding = await getLiveBinding(salonId);
  if (!binding) {
    return errorResponse('NOT_CONNECTED', 'No connected payment account.', 404);
  }

  // Rule W-SE: the audit row and the owner alert fire inside `revokeBinding` only
  // when the CAS reports exactly one affected row, so a double-click cannot
  // re-emit them.
  const revoked = await revokeBinding(binding.id, 'revoked_local', {
    actorId: auth.admin.id,
    viaSuperAdminWithoutMembership: Boolean(auth.admin.isSuperAdmin)
      && !auth.admin.salons.some(membership => membership.salonId === salonId),
    salonId,
    stripeAccountId: binding.stripeAccountId,
    reason,
  });

  if (!revoked) {
    // Someone else revoked it between our read and our CAS. Idempotent success.
    return NextResponse.json({ revoked: false, status: 'revoked' });
  }

  return NextResponse.json({ revoked: true, status: 'revoked' });
}
