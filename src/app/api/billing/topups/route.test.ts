/**
 * Top-up purchase history — G17 (§15 row C3) proofs: dark returns a static
 * `available:false` before any DB read, cross-salon is 403 via the shared
 * `requireAdmin` guard, pagination walks a compound (createdAt, id) cursor,
 * the sms_topup_purchase status vocabulary maps to the small owner-facing
 * set with the right `holdState`, and no Stripe id ever leaves the route.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  BILLING_TOPUPS_ENABLED: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const adminHolder = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => adminHolder.allowed
    ? { ok: true, admin: { clerkUserId: 'user_topups' } }
    : { ok: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) }),
}));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  envHolder.BILLING_TOPUPS_ENABLED = 'true';
  adminHolder.allowed = true;
});

const getTopups = async (query: string) => {
  const { GET } = await import('./route');
  return GET(new (await import('next/server')).NextRequest(`http://localhost/api/billing/topups?${query}`));
};

let salonCounter = 0;
async function seedSalon(plan: string | null = 'single_salon'): Promise<string> {
  salonCounter += 1;
  const id = `sal_tu_${salonCounter}`;
  await db.insert(schema.salonSchema).values({ id, name: id, slug: id, plan });
  return id;
}

let purchaseCounter = 0;
async function seedPurchase(salonId: string, overrides: Partial<{
  status: schema.SmsTopupPurchaseStatus;
  credits: number;
  amountCents: number;
  createdAt: Date;
  refundedAt: Date | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeRefundId: string | null;
  grantLedgerId: string | null;
  topupOfferKey: string;
}> = {}): Promise<string> {
  purchaseCounter += 1;
  const id = `stp_${purchaseCounter}`;
  await db.insert(schema.smsTopupPurchaseSchema).values({
    id,
    salonId,
    topupOfferKey: overrides.topupOfferKey ?? 'topup_100_paid_2026_08',
    credits: overrides.credits ?? 100,
    amountCents: overrides.amountCents ?? 599,
    currency: 'cad',
    status: overrides.status ?? 'checkout_created',
    createdAt: overrides.createdAt ?? new Date(),
    refundedAt: overrides.refundedAt ?? null,
    stripeCheckoutSessionId: overrides.stripeCheckoutSessionId ?? null,
    stripePaymentIntentId: overrides.stripePaymentIntentId ?? null,
    stripeRefundId: overrides.stripeRefundId ?? null,
    grantLedgerId: overrides.grantLedgerId ?? null,
  });
  return id;
}

async function seedLedgerGrant(salonId: string, credits: number, createdAt: Date): Promise<string> {
  const id = `scl_${purchaseCounter}_grant`;
  await db.insert(schema.smsCreditLedgerSchema).values({
    id,
    salonId,
    entryType: 'grant',
    bucket: 'purchased',
    amount: credits,
    idempotencyKey: `topup-grant:${id}`,
    reason: 'topup_fulfillment',
    createdAt,
  });
  return id;
}

async function seedAttempt(salonId: string, overrides: Partial<{
  status: schema.BillingCheckoutAttemptStatus;
  expiresAt: Date;
  stripeCheckoutSessionId: string | null;
}> = {}): Promise<string> {
  purchaseCounter += 1;
  const id = `bca_${purchaseCounter}`;
  await db.insert(schema.billingCheckoutAttemptSchema).values({
    id,
    salonId,
    purpose: 'sms_topup',
    topupOfferKey: 'topup_100_paid_2026_08',
    status: overrides.status ?? 'checkout_created',
    stripeIdempotencyKey: `idem_${id}`,
    stripeCheckoutSessionId: overrides.stripeCheckoutSessionId ?? null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
  });
  return id;
}

describe('dark switch', () => {
  it('returns a static available:false before any database read', async () => {
    envHolder.BILLING_TOPUPS_ENABLED = undefined;
    const selectSpy = vi.spyOn(db, 'select');
    const salonId = await seedSalon();
    selectSpy.mockClear();

    const response = await getTopups(`salonId=${salonId}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false, items: [], nextCursor: null });
    expect(selectSpy).not.toHaveBeenCalled();

    selectSpy.mockRestore();
  });
});

describe('tenant scoping', () => {
  it('rejects a salon the admin is not a member of with 403', async () => {
    const salonId = await seedSalon();
    adminHolder.allowed = false;

    const response = await getTopups(`salonId=${salonId}`);

    expect(response.status).toBe(403);
  });

  it('requires salonId', async () => {
    const response = await getTopups('');

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('SALON_ID_REQUIRED');
  });
});

describe('pagination (compound createdAt,id cursor)', () => {
  it('walks three rows two at a time', async () => {
    const salonId = await seedSalon();
    const base = Date.now();
    await seedPurchase(salonId, { createdAt: new Date(base - 3000), status: 'fulfilled' });
    await seedPurchase(salonId, { createdAt: new Date(base - 2000), status: 'fulfilled' });
    await seedPurchase(salonId, { createdAt: new Date(base - 1000), status: 'fulfilled' });

    const first = await getTopups(`salonId=${salonId}&limit=2`);
    const firstBody = await first.json();

    expect(firstBody.available).toBe(true);
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();
    // Newest first.
    expect(new Date(firstBody.items[0].createdAt).getTime()).toBeGreaterThan(new Date(firstBody.items[1].createdAt).getTime());

    const second = await getTopups(`salonId=${salonId}&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`);
    const secondBody = await second.json();

    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();

    const seenIds = new Set([...firstBody.items, ...secondBody.items].map((item: { id: string }) => item.id));

    expect(seenIds.size).toBe(3);
  });

  it('rejects a malformed cursor', async () => {
    const salonId = await seedSalon();
    const response = await getTopups(`salonId=${salonId}&cursor=not-valid-base64url!!`);

    expect(response.status).toBe(400);
  });
});

describe('status and holdState mapping', () => {
  it('a fulfilled purchase: status=fulfilled, holdState=null, fulfilledAt from the ledger grant', async () => {
    const salonId = await seedSalon();
    const grantedAt = new Date('2026-08-01T12:00:00.000Z');
    const ledgerId = await seedLedgerGrant(salonId, 100, grantedAt);
    await seedPurchase(salonId, {
      status: 'fulfilled',
      grantLedgerId: ledgerId,
      stripeCheckoutSessionId: 'cs_fulfilled_case',
    });

    const body = await (await getTopups(`salonId=${salonId}`)).json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      status: 'fulfilled',
      holdState: null,
      fulfilledAt: grantedAt.toISOString(),
      reversedAt: null,
    });
  });

  it('a pending purchase whose attempt is past expiry: status=pending, holdState=held', async () => {
    const salonId = await seedSalon();
    const sessionId = 'cs_pending_expired';
    await seedAttempt(salonId, {
      status: 'checkout_created',
      stripeCheckoutSessionId: sessionId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await seedPurchase(salonId, { status: 'checkout_created', stripeCheckoutSessionId: sessionId });

    const body = await (await getTopups(`salonId=${salonId}`)).json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe('pending');
    expect(body.items[0].holdState).toBe('held');
  });

  it('a pending purchase held because the salon has more than one open attempt', async () => {
    const salonId = await seedSalon();
    await seedAttempt(salonId, { status: 'checkout_created', expiresAt: new Date(Date.now() + 60_000) });
    await seedAttempt(salonId, { status: 'creating', expiresAt: new Date(Date.now() + 60_000) });
    await seedPurchase(salonId, { status: 'paid' });

    const body = await (await getTopups(`salonId=${salonId}`)).json();

    expect(body.items[0].status).toBe('pending');
    expect(body.items[0].holdState).toBe('held');
  });

  it('a pending purchase with a live, sole attempt is NOT held', async () => {
    const salonId = await seedSalon();
    const sessionId = 'cs_pending_live';
    await seedAttempt(salonId, {
      status: 'checkout_created',
      stripeCheckoutSessionId: sessionId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await seedPurchase(salonId, { status: 'checkout_created', stripeCheckoutSessionId: sessionId });

    const body = await (await getTopups(`salonId=${salonId}`)).json();

    expect(body.items[0].status).toBe('pending');
    expect(body.items[0].holdState).toBeNull();
  });

  it('a reversed (partially_reversed) purchase: status=reversed, reversedAt from refundedAt', async () => {
    const salonId = await seedSalon();
    const reversedAt = new Date('2026-08-15T09:00:00.000Z');
    await seedPurchase(salonId, { status: 'partially_reversed', refundedAt: reversedAt });

    const body = await (await getTopups(`salonId=${salonId}`)).json();

    expect(body.items[0]).toMatchObject({ status: 'reversed', holdState: null, reversedAt: reversedAt.toISOString() });
  });

  it('a fully refunded purchase: status=refunded', async () => {
    const salonId = await seedSalon();
    await seedPurchase(salonId, { status: 'refunded', refundedAt: new Date() });
    const body = await (await getTopups(`salonId=${salonId}`)).json();

    expect(body.items[0].status).toBe('refunded');
  });

  it('a disputed purchase: status=disputed', async () => {
    const salonId = await seedSalon();
    await seedPurchase(salonId, { status: 'disputed', refundedAt: new Date() });
    const body = await (await getTopups(`salonId=${salonId}`)).json();

    expect(body.items[0].status).toBe('disputed');
  });

  it('an expired purchase: status=expired, never held', async () => {
    const salonId = await seedSalon();
    await seedPurchase(salonId, { status: 'expired' });
    const body = await (await getTopups(`salonId=${salonId}`)).json();

    expect(body.items[0]).toMatchObject({ status: 'expired', holdState: null });
  });
});

describe('masking', () => {
  it('never leaks a Stripe id, whatever the underlying row holds', async () => {
    const salonId = await seedSalon();
    const ledgerId = await seedLedgerGrant(salonId, 250, new Date());
    await seedPurchase(salonId, {
      status: 'fulfilled',
      grantLedgerId: ledgerId,
      stripeCheckoutSessionId: 'cs_leak_test_session',
      stripePaymentIntentId: 'pi_leak_test_intent',
      stripeRefundId: 'ch_leak_test_charge',
      topupOfferKey: 'topup_250_paid_2026_08',
    });

    const response = await getTopups(`salonId=${salonId}`);
    const serialized = JSON.stringify(await response.json());

    expect(serialized).not.toMatch(/\bcs_|\bpi_|\bprice_|\bch_/);
  });
});
