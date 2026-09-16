/**
 * R-2 super-admin refund-evidence endpoint — PGlite proofs against real
 * migrations, mirroring the auth/rate-limit/DB mocking conventions of
 * `src/app/api/super-admin/billing/starter-grant/route.test.ts`.
 *
 * The properties that matter operationally: nothing is reachable without a
 * super-admin session, `plan` writes NOTHING, the tenant check cannot be
 * bypassed by guessing a Stripe id, a `void` that finds nothing live says so
 * (409) rather than reporting a repair that never happened, and every
 * unexpected failure is masked behind one code.
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
  BILLING_PLAN_ENV: 'test' as string,
  BILLING_IDENTITY_HMAC_SECRET: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined as number | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const guard = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin: guard.requireSuperAdmin }));

type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

const rateLimit = vi.hoisted(() => ({
  checkEndpointRateLimit: vi.fn((): RateLimitDecision => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
  rateLimitResponse: vi.fn((retryAfterMs: number) =>
    Response.json({ error: { code: 'RATE_LIMIT_EXCEEDED', retryAfterMs } }, { status: 429 })),
}));
vi.mock('@/libs/rateLimit', () => rateLimit);

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const { POST } = await import('./route');
const Sentry = await import('@sentry/nextjs');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let db: Db;

const SUPER_ADMIN = { ok: true as const, admin: { id: 'sa_refund_evidence_1', email: 'super@luster.test' } };

function post(body: unknown): Promise<Response> {
  return POST(new Request('http://localhost/api/super-admin/billing/refund-evidence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

let counter = 0;

async function seed(input: {
  slug?: string;
  deletedAt?: Date | null;
  paidThrough?: Date;
  anchor?: Date;
}) {
  counter += 1;
  const salonId = `s_re_${counter}`;
  const subId = `sub_re_${counter}`;
  const slug = input.slug ?? `re-salon-${counter}`;
  await db.insert(schema.salonSchema).values({
    id: salonId,
    name: salonId,
    slug,
    deletedAt: input.deletedAt ?? null,
  });
  await db.insert(schema.billingSubscriptionSchema).values({
    id: `bsub_${subId}`,
    salonId,
    stripeSubscriptionId: subId,
    stripeCustomerId: `cus_${subId}`,
    planDefinitionKey: 'pro_2026_08',
    billingOfferKey: 'pro_2026_08_monthly',
    billingCadence: 'monthly',
    status: 'active',
    paidThrough: input.paidThrough ?? new Date('2026-10-01T10:00:00.000Z'),
    creditCycleAnchor: input.anchor ?? new Date('2026-09-01T10:00:00.000Z'),
  });
  return { salonId, subId, slug, subscriptionRowId: `bsub_${subId}` };
}

async function seedRefundEvidence(input: {
  salonId: string;
  subscriptionRowId: string;
  invoiceId: string;
  start?: Date;
  end?: Date;
}) {
  counter += 1;
  await db.insert(schema.auditLogSchema).values({
    id: `al_re_${counter}`,
    salonId: input.salonId,
    actorType: 'webhook',
    actorId: 'stripe-billing',
    action: 'billing_subscription_refund_applied',
    entityType: 'billing_subscription',
    entityId: input.subscriptionRowId,
    metadata: {
      evidenceVersion: 2,
      seq: 1,
      invoiceId: input.invoiceId,
      refundIds: ['re_seeded'],
      eventId: 'evt_seeded',
      // Omitted bounds = the malformed legacy shape a `set` resolution repairs.
      ...(input.start !== undefined && input.end !== undefined
        ? { refundedPeriodStart: input.start.toISOString(), refundedPeriodEnd: input.end.toISOString() }
        : {}),
    },
  });
}

const resolutionRows = async (subscriptionRowId: string) =>
  (await db.select().from(schema.auditLogSchema))
    .filter(row => row.action === 'billing_subscription_refund_evidence_resolved' && row.entityId === subscriptionRowId);

async function rowCounts() {
  return {
    auditRows: (await db.select().from(schema.auditLogSchema)).length,
    ledgerRows: (await db.select().from(schema.smsCreditLedgerSchema)).length,
  };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  vi.clearAllMocks();
  guard.requireSuperAdmin.mockResolvedValue(SUPER_ADMIN);
  rateLimit.checkEndpointRateLimit.mockReturnValue({ allowed: true });
});

describe('POST /api/super-admin/billing/refund-evidence — auth and input', () => {
  it('401s with no admin session, before any body parsing or write', async () => {
    guard.requireSuperAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const before = await rowCounts();

    const response = await post({ salonSlug: 'anything', mode: 'plan' });

    expect(response.status).toBe(401);
    expect(await rowCounts()).toEqual(before);
  });

  it('403s an admin who is not a super-admin', async () => {
    guard.requireSuperAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    expect((await post({ salonSlug: 'anything', mode: 'plan' })).status).toBe(403);
  });

  it('rate-limits before touching the database', async () => {
    rateLimit.checkEndpointRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 5000 });

    const response = await post({ salonSlug: 'whatever', mode: 'plan' });

    expect(response.status).toBe(429);
    expect(rateLimit.rateLimitResponse).toHaveBeenCalledWith(5000);
  });

  it('400s invalid JSON and incomplete bodies', async () => {
    const malformed = await POST(new Request('http://localhost/api/super-admin/billing/refund-evidence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    }));

    expect(malformed.status).toBe(400);
    expect((await post({ salonSlug: 'x', mode: 'plan' })).status).toBe(400);
    expect((await post({
      salonSlug: 'x',
      stripeSubscriptionId: 'sub_x',
      invoiceId: 'in_x',
      resolution: 'delete',
      reason: 'because',
      mode: 'plan',
    })).status).toBe(400);
  });

  it('400s an apply whose confirmation does not exactly match the invoice id, writing nothing', async () => {
    const { slug, subId, salonId, subscriptionRowId } = await seed({});
    await seedRefundEvidence({
      salonId,
      subscriptionRowId,
      invoiceId: 'in_confirm',
      start: new Date('2026-09-01T10:00:00.000Z'),
      end: new Date('2026-10-01T10:00:00.000Z'),
    });
    const before = await rowCounts();
    const base = {
      salonSlug: slug,
      stripeSubscriptionId: subId,
      invoiceId: 'in_confirm',
      resolution: 'void',
      reason: 'the refund failed at the bank',
      mode: 'apply',
    };

    const missing = await post(base);

    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe('CONFIRMATION_REQUIRED');

    const wrong = await post({ ...base, confirmation: slug });

    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe('CONFIRMATION_REQUIRED');
    expect(await rowCounts()).toEqual(before);
  });

  it('400s a `set` without a valid half-open window, writing nothing', async () => {
    const { slug, subId } = await seed({});
    const before = await rowCounts();
    const base = {
      salonSlug: slug,
      stripeSubscriptionId: subId,
      invoiceId: 'in_bounds',
      resolution: 'set',
      reason: 'legacy evidence repair',
      mode: 'apply',
      confirmation: 'in_bounds',
    };

    expect((await post(base)).status).toBe(400); // no bounds at all
    expect((await post({ ...base, periodStart: 'not-a-date', periodEnd: '2026-10-01T10:00:00.000Z' })).status).toBe(400);
    expect((await post({
      ...base,
      periodStart: '2026-10-01T10:00:00.000Z',
      periodEnd: '2026-09-01T10:00:00.000Z', // end before start
    })).status).toBe(400);
    expect(await rowCounts()).toEqual(before);
  });
});

describe('POST /api/super-admin/billing/refund-evidence — plan', () => {
  it('returns the EFFECTIVE evidence and writes nothing', async () => {
    const { slug, subId, salonId, subscriptionRowId } = await seed({
      paidThrough: new Date('2026-09-01T10:00:00.000Z'),
    });
    await seedRefundEvidence({
      salonId,
      subscriptionRowId,
      invoiceId: 'in_plan',
      start: new Date('2026-09-01T10:00:00.000Z'),
      end: new Date('2026-10-01T10:00:00.000Z'),
    });
    const before = await rowCounts();

    const response = await post({
      salonSlug: slug,
      stripeSubscriptionId: subId,
      invoiceId: 'in_plan',
      resolution: 'void',
      reason: 'checking before acting',
      mode: 'plan',
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      mode: 'plan',
      subscription: { stripeSubscriptionId: subId, paidThrough: '2026-09-01T10:00:00.000Z' },
      evidence: {
        incomplete: false,
        rows: 1,
        nextSeq: 2,
        appliedInvoiceIds: ['in_plan'],
        refunds: [{
          invoiceId: 'in_plan',
          start: '2026-09-01T10:00:00.000Z',
          end: '2026-10-01T10:00:00.000Z',
        }],
      },
      intended: { invoiceId: 'in_plan', resolution: 'void', currentlyRefunded: true },
    });
    expect(await rowCounts()).toEqual(before);
  });

  it('reports currentlyRefunded:false for an invoice with no live evidence', async () => {
    const { slug, subId } = await seed({});

    const response = await post({
      salonSlug: slug,
      stripeSubscriptionId: subId,
      invoiceId: 'in_never_refunded',
      resolution: 'void',
      reason: 'checking',
      mode: 'plan',
    });
    const json = await response.json();

    expect(json.intended.currentlyRefunded).toBe(false);
    expect(json.evidence).toMatchObject({ rows: 0, nextSeq: 1, incomplete: false, appliedInvoiceIds: [] });
  });

  it('404s an unknown slug and 409s a soft-deleted salon', async () => {
    const unknown = await post({
      salonSlug: 'no-such-salon',
      stripeSubscriptionId: 'sub_x',
      invoiceId: 'in_x',
      resolution: 'void',
      reason: 'r',
      mode: 'plan',
    });

    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('SALON_NOT_FOUND');

    const { slug, subId } = await seed({ deletedAt: new Date() });
    const deleted = await post({
      salonSlug: slug,
      stripeSubscriptionId: subId,
      invoiceId: 'in_x',
      resolution: 'void',
      reason: 'r',
      mode: 'plan',
    });

    expect(deleted.status).toBe(409);
    expect((await deleted.json()).error.code).toBe('SALON_DELETED');
  });

  it('404s a subscription that belongs to a DIFFERENT salon (tenant scope)', async () => {
    const mine = await seed({});
    const theirs = await seed({});

    const response = await post({
      salonSlug: mine.slug,
      stripeSubscriptionId: theirs.subId, // a real id — but not this salon's
      invoiceId: 'in_x',
      resolution: 'void',
      reason: 'r',
      mode: 'plan',
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });
});

describe('POST /api/super-admin/billing/refund-evidence — apply', () => {
  it('voids live evidence, restores paid_through and re-evaluates windows', async () => {
    const start = new Date('2026-09-01T10:00:00.000Z');
    const end = new Date('2026-10-01T10:00:00.000Z');
    const { slug, subId, salonId, subscriptionRowId } = await seed({
      paidThrough: start, // lowered when the refund was applied
      anchor: start,
    });
    await seedRefundEvidence({ salonId, subscriptionRowId, invoiceId: 'in_void', start, end });

    const response = await post({
      salonSlug: slug,
      stripeSubscriptionId: subId,
      invoiceId: 'in_void',
      resolution: 'void',
      reason: 'Stripe reversed the refund; bank returned it',
      mode: 'apply',
      confirmation: 'in_void',
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ mode: 'apply', applied: true, reapplied: true });

    const resolutions = await resolutionRows(subscriptionRowId);

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({
      salonId,
      actorType: 'super_admin',
      actorId: SUPER_ADMIN.admin.id,
      entityType: 'billing_subscription',
      entityId: subscriptionRowId,
    });
    expect(resolutions[0]!.metadata).toMatchObject({
      evidenceVersion: 2,
      seq: 2,
      invoiceId: 'in_void',
      resolution: 'void',
      reason: 'Stripe reversed the refund; bank returned it',
    });

    const updated = (await db.select().from(schema.billingSubscriptionSchema))
      .find(entry => entry.stripeSubscriptionId === subId);

    // The captured coverage was replayed through the ordinary payment
    // transition, which re-establishes paid_through AND runs the engine.
    expect(updated!.paidThrough.getTime()).toBe(end.getTime());

    const grants = (await db.select().from(schema.smsCreditLedgerSchema))
      .filter(entry => entry.salonId === salonId);

    expect(grants.length).toBeGreaterThan(0);
  });

  it('409s NOTHING_TO_VOID when the invoice is not currently recorded as refunded, writing nothing', async () => {
    const { slug, subId } = await seed({});
    const before = await rowCounts();

    const response = await post({
      salonSlug: slug,
      stripeSubscriptionId: subId,
      invoiceId: 'in_not_refunded',
      resolution: 'void',
      reason: 'operator guess',
      mode: 'apply',
      confirmation: 'in_not_refunded',
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('NOTHING_TO_VOID');
    expect(await rowCounts()).toEqual(before);
  });

  it('sets authoritative coverage on malformed legacy evidence and lowers paid_through', async () => {
    const start = new Date('2026-09-01T10:00:00.000Z');
    const end = new Date('2026-10-01T10:00:00.000Z');
    const { slug, subId, salonId, subscriptionRowId } = await seed({
      paidThrough: end, // inside (start, end] ⇒ lowered to start
      anchor: start,
    });
    // Legacy evidence with NO bounds: reads back `incomplete`, which fails
    // every window closed — the condition this endpoint exists to repair.
    await seedRefundEvidence({ salonId, subscriptionRowId, invoiceId: 'in_legacy' });

    const response = await post({
      salonSlug: slug,
      stripeSubscriptionId: subId,
      invoiceId: 'in_legacy',
      resolution: 'set',
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      reason: 'authoritative coverage from the Stripe invoice',
      mode: 'apply',
      confirmation: 'in_legacy',
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ mode: 'apply', applied: true, lowered: true, seq: 2 });

    const resolutions = await resolutionRows(subscriptionRowId);

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]!.metadata).toMatchObject({
      invoiceId: 'in_legacy',
      resolution: 'set',
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    });

    const updated = (await db.select().from(schema.billingSubscriptionSchema))
      .find(entry => entry.stripeSubscriptionId === subId);

    expect(updated!.paidThrough.getTime()).toBe(start.getTime());

    // And the evidence now reads back CLEAN — no longer `incomplete`.
    const { readSubscriptionRefunds } = await import('@/libs/billing/subscriptionRefunds');
    const evidence = await readSubscriptionRefunds(db as never, { id: subscriptionRowId, salonId });

    expect(evidence.incomplete).toBe(false);
    expect(evidence.refunds).toEqual([{ invoiceId: 'in_legacy', start, end }]);
  });

  it('404s an apply for a subscription outside the named salon (tenant scope)', async () => {
    const mine = await seed({});
    const theirs = await seed({});
    const before = await rowCounts();

    const response = await post({
      salonSlug: mine.slug,
      stripeSubscriptionId: theirs.subId,
      invoiceId: 'in_x',
      resolution: 'void',
      reason: 'r',
      mode: 'apply',
      confirmation: 'in_x',
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('SUBSCRIPTION_NOT_FOUND');
    expect(await rowCounts()).toEqual(before);
  });

  it('masks any unexpected failure behind REFUND_EVIDENCE_ERROR, leaking nothing but the caller\'s own inputs', async () => {
    const { slug, subId, salonId, subscriptionRowId } = await seed({});
    // Evidence whose stored bounds are a string the reader cannot parse
    // is not itself fatal; force a genuine failure instead by making the
    // resolution writer reject invalid input it should never receive.
    await seedRefundEvidence({
      salonId,
      subscriptionRowId,
      invoiceId: 'in_boom',
      start: new Date('2026-09-01T10:00:00.000Z'),
      end: new Date('2026-10-01T10:00:00.000Z'),
    });
    const projection = await import('@/libs/billing/billingSubscriptionProjection');
    const spy = vi.spyOn(projection, 'applySubscriptionRefundEvidenceResolution')
      .mockRejectedValue(new Error('pg: connection reset by peer'));

    const response = await post({
      salonSlug: slug,
      stripeSubscriptionId: subId,
      invoiceId: 'in_boom',
      resolution: 'void',
      reason: 'r',
      mode: 'apply',
      confirmation: 'in_boom',
    });
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error.code).toBe('REFUND_EVIDENCE_ERROR');
    expect(JSON.stringify(json)).not.toContain('connection reset');
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { endpoint: 'super-admin/billing/refund-evidence' },
      extra: { salonSlug: slug, mode: 'apply' },
    });

    spy.mockRestore();
  });
});
