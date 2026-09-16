/**
 * Top-up expiry classification (D19c §2.3 item 3), on PGlite.
 *
 * The fulfillment/reversal arithmetic itself is proved end-to-end through the
 * webhook in `src/app/api/billing/checkout/topup/route.test.ts`; THIS suite
 * pins only the seam PR-2 introduced — a missing purchase row is RETURNED to
 * a caller that can classify it, while the callers that cannot (the top-up
 * checkout route's reuse path, P4's held-attempt reconciler) keep the exact
 * throwing contract they had before.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/Env', () => ({
  Env: {
    BILLING_IDENTITY_HMAC_SECRET: undefined,
    BILLING_IDENTITY_HMAC_VERSION: undefined,
  },
}));

const stripeMock = vi.hoisted(() => ({
  checkout: { sessions: { retrieve: vi.fn() } },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

const fulfillment = () => import('./topupFulfillment');

async function seedPurchase(input: { salonId: string; sessionId: string; purchaseId: string }) {
  await db.insert(schema.salonSchema).values({
    id: input.salonId,
    name: input.salonId,
    slug: input.salonId,
  });
  await db.insert(schema.smsTopupPurchaseSchema).values({
    id: input.purchaseId,
    salonId: input.salonId,
    topupOfferKey: 'topup_100_paid_2026_08',
    credits: 100,
    amountCents: 599,
    status: 'checkout_created',
    stripeCheckoutSessionId: input.sessionId,
  });
}

describe('resolveTopupSessionExpiry (§2.3 item 3)', () => {
  it('parks a bound, unfulfilled purchase as expired', async () => {
    const { resolveTopupSessionExpiry } = await fulfillment();
    await seedPurchase({ salonId: 's_exp_ok', sessionId: 'cs_exp_ok', purchaseId: 'stp_exp_ok' });

    expect(await resolveTopupSessionExpiry('cs_exp_ok')).toEqual({ expired: true });

    const [purchase] = await db.select().from(schema.smsTopupPurchaseSchema)
      .where(eq(schema.smsTopupPurchaseSchema.id, 'stp_exp_ok'));

    expect(purchase!.status).toBe('expired');
  });

  it('RETURNS the missing-purchase reason instead of throwing, so the caller can classify it', async () => {
    const { resolveTopupSessionExpiry } = await fulfillment();

    expect(await resolveTopupSessionExpiry('cs_never_bound')).toEqual({
      expired: false,
      reason: 'PURCHASE_NOT_FOUND',
    });
  });

  it('reports expired:false without a reason when the purchase exists but is not parkable', async () => {
    const { resolveTopupSessionExpiry } = await fulfillment();
    await seedPurchase({ salonId: 's_exp_paid', sessionId: 'cs_exp_paid', purchaseId: 'stp_exp_paid' });
    await db.update(schema.smsTopupPurchaseSchema).set({ status: 'fulfilled' })
      .where(eq(schema.smsTopupPurchaseSchema.id, 'stp_exp_paid'));

    expect(await resolveTopupSessionExpiry('cs_exp_paid')).toEqual({ expired: false });
  });
});

describe('applyTopupSessionExpired keeps its throwing contract for callers that cannot classify', () => {
  it('still throws TOPUP_PURCHASE_NOT_FOUND when nothing is bound to the session', async () => {
    const { applyTopupSessionExpired } = await fulfillment();

    await expect(applyTopupSessionExpired('cs_never_bound_2')).rejects.toThrow('TOPUP_PURCHASE_NOT_FOUND');
  });

  it('returns the same {expired} shape it always did on success', async () => {
    const { applyTopupSessionExpired } = await fulfillment();
    await seedPurchase({ salonId: 's_exp_legacy', sessionId: 'cs_exp_legacy', purchaseId: 'stp_exp_legacy' });

    expect(await applyTopupSessionExpired('cs_exp_legacy')).toEqual({ expired: true });
  });
});
