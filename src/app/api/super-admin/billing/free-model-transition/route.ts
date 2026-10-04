import { eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { logAuditEventTx } from '@/libs/auditLog';
import { BusinessIdentityError } from '@/libs/billing/businessIdentity';
import { lockCreditAccount, recomputeCachedBalance } from '@/libs/billing/creditLedger';
import { applyStarterGrantBackfill, planStarterGrantBackfill, StarterGrantBackfillError } from '@/libs/billing/starterGrantBackfill';
import { transitionSalonSubscriptionRenewals } from '@/libs/billing/subscriptionRenewalTransition';
import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { salonSchema } from '@/models/Schema';

const inputSchema = z.object({
  salonSlug: z.string().min(1),
  mode: z.enum(['plan', 'apply']),
  confirmation: z.string().optional(),
}).strict();

/** Read-only inventory. No grants, links, account writes, or Stripe changes. */
export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }
  const result = await db.execute(sql`
    SELECT s.id, s.slug,
      EXISTS (SELECT 1 FROM sms_credit_account a WHERE a.salon_id = s.id) AS account_exists,
      EXISTS (SELECT 1 FROM billing_starter_grant g WHERE g.salon_id = s.id
        OR g.business_identity_id IN (SELECT business_identity_id FROM billing_business_identity_link WHERE link_type = 'salon' AND link_value = s.id)) AS starter_claimed,
      EXISTS (SELECT 1 FROM billing_subscription bs WHERE bs.salon_id = s.id)
        OR s.stripe_subscription_id IS NOT NULL AS has_subscription
    FROM salon s WHERE s.deleted_at IS NULL ORDER BY s.id
  `);
  return Response.json({ salons: result.rows }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** One salon per transaction/batch boundary; retries preserve all existing evidence. */
export async function POST(request: Request) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }
  const limit = checkEndpointRateLimit('super-admin/billing/free-model-transition', getClientIp(request), 'BILLING');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'salonSlug and mode are required' }, { status: 400 });
  }
  const { salonSlug, mode, confirmation } = parsed.data;
  if (mode === 'apply' && confirmation !== salonSlug) {
    return Response.json({ error: 'confirmation must match salonSlug' }, { status: 400 });
  }
  const [salon] = await db.select({ id: salonSchema.id }).from(salonSchema)
    .where(eq(salonSchema.slug, salonSlug)).limit(1);
  if (!salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  const [active] = await db.select({ id: salonSchema.id }).from(salonSchema)
    .where(sql`${salonSchema.id} = ${salon.id} AND ${isNull(salonSchema.deletedAt)}`).limit(1);
  if (!active) {
    return Response.json({ error: 'Salon unavailable' }, { status: 409 });
  }
  const renewals = await transitionSalonSubscriptionRenewals(salon.id, guard.admin.id, mode === 'apply');
  if (mode === 'apply') {
    await db.transaction(async (tx) => {
      await lockCreditAccount(tx, salon.id);
      await recomputeCachedBalance(tx, salon.id, new Date());
      await logAuditEventTx(tx, {
        actorType: 'super_admin',
        actorId: guard.admin.id,
        action: 'free_model_credit_account_initialized',
        salonId: salon.id,
        entityType: 'salon',
        entityId: salon.id,
        metadata: { policy: 'free_sms_topups_2026_10' },
      });
    });
  }
  try {
    const starter = mode === 'plan'
      ? await planStarterGrantBackfill(db, { salonSlug })
      : await applyStarterGrantBackfill(db, { salonSlug, actorId: guard.admin.id });
    return Response.json({ salonId: salon.id, renewals, starter });
  } catch (error) {
    if (error instanceof BusinessIdentityError || error instanceof StarterGrantBackfillError) {
      return Response.json({ salonId: salon.id, renewals, starter: { granted: false, heldReason: error.code } });
    }
    throw error;
  }
}

export const dynamic = 'force-dynamic';
