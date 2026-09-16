/**
 * C2 webhook financial semantics — PGlite proofs for the §8.2 claim
 * machinery and the §8.3/§8.4/§3.9 projection: strict-< staleness with
 * equal-second eligibility, monotonic paid_through, engine-only granting,
 * paid-evidence-gated founding effects, pending-downgrade-at-renewal, and
 * the §2.3 duplicate-subscription policy.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
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
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// G02: default to the REAL (all-placeholder ⇒ always-null) reverse lookup;
// individual tests override `resolvedOfferKey` to simulate a CONFIGURED map.
const priceMapHolder = vi.hoisted(() => ({ resolvedOfferKey: null as string | null }));
vi.mock('@/libs/billing/stripePriceMap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/stripePriceMap')>();
  return {
    ...actual,
    resolveBillingOfferFromStripePriceId: (_priceId: string) => priceMapHolder.resolvedOfferKey,
  };
});

// G15/§3.9 — wraps the REAL resolver so renewal behaviour is unchanged
// while recording every call, proving the pending-offer-at-renewal path is
// actually wired through it (the §3.9 vectors themselves live in
// rateProtection.test.ts).
const rateProtectionHolder = vi.hoisted(() => ({
  calls: [] as { currentOfferKey: string; rateProtectedThrough: Date | null; servicePeriodStart: Date }[],
}));
vi.mock('@/libs/billing/rateProtection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/rateProtection')>();
  return {
    ...actual,
    resolveOfferForServicePeriod: (input: Parameters<typeof actual.resolveOfferForServicePeriod>[0]) => {
      rateProtectionHolder.calls.push(input);
      return actual.resolveOfferForServicePeriod(input);
    },
  };
});

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  priceMapHolder.resolvedOfferKey = null;
  rateProtectionHolder.calls = [];
});

const events = () => import('./billingStripeEvents');
const projection = () => import('./billingSubscriptionProjection');

const T0 = new Date('2026-09-01T10:00:00.000Z');
const T0_PLUS_MONTH = new Date('2026-10-01T10:00:00.000Z');

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: id, slug: id });
}

function snapshot(over: Partial<import('./billingSubscriptionProjection').StripeSubscriptionSnapshot> & { salonId: string }) {
  return {
    id: over.id ?? 'sub_stripe_1',
    customerId: 'cus_1',
    status: over.status ?? 'active',
    cancelAtPeriodEnd: over.cancelAtPeriodEnd ?? false,
    currentPeriodStart: over.currentPeriodStart ?? T0,
    priceId: over.priceId ?? null,
    metadata: {
      salonId: over.salonId,
      billingOfferKey: 'pro_2026_08_monthly',
      ...(over.metadata ?? {}),
    },
  };
}

const monthlyLedger = async (salonId: string) => {
  const rows = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::int AS total FROM sms_credit_ledger
    WHERE salon_id = ${salonId} AND bucket = 'monthly'
  `);
  return Number((rows.rows[0] as Record<string, unknown>).total);
};

describe('billing event claim machinery (§8.2)', () => {
  it('claims once, rejects replay, reclaims after backoff, poisons at the cap', async () => {
    const { claimBillingEvent, failBillingEvent } = await events();
    const base = {
      eventId: 'evt_claim_1',
      eventType: 'invoice.payment_succeeded',
      livemode: false,
      apiCreatedAt: T0,
      now: T0,
    };

    expect(await claimBillingEvent(base)).toEqual({ claimed: true, attempts: 1 });
    expect((await claimBillingEvent(base)).claimed).toBe(false);

    // Handler failed → retryable with backoff; before backoff no reclaim,
    // after backoff the SAME event id claims again with attempts 2.
    await failBillingEvent({ eventId: 'evt_claim_1', attempts: 1, error: 'boom', now: T0 });

    expect((await claimBillingEvent({ ...base, now: new Date(T0.getTime() + 1000) })).claimed).toBe(false);

    const afterBackoff = new Date(T0.getTime() + 61_000);

    expect(await claimBillingEvent({ ...base, now: afterBackoff })).toEqual({ claimed: true, attempts: 2 });

    // The 8th failure poisons and stays terminal.
    const poisoned = await failBillingEvent({ eventId: 'evt_claim_1', attempts: 8, error: 'still boom', now: afterBackoff });

    expect(poisoned.poisoned).toBe(true);
    expect((await claimBillingEvent({ ...base, now: new Date(afterBackoff.getTime() + 7_200_000) })).claimed).toBe(false);
  });
});

describe('subscription projection (§8.3/§8.4)', () => {
  it('creates with ZERO entitlement, applies equal-second events, rejects strictly older ones', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    await seedSalon('s_proj1');
    const created = await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_proj1', id: 'sub_p1' }),
      eventCreated: T0,
      eventId: 'evt_p1_create',
    });

    expect(created).toEqual({ applied: true, kind: 'created' });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_p1'));

    // paid_through == anchor: no invoice has succeeded, so nothing is covered.
    expect(row!.paidThrough.getTime()).toBe(T0.getTime());
    expect(row!.creditCycleAnchor.getTime()).toBe(T0.getTime());

    // EQUAL second (distinct event): must remain eligible (§8.3).
    const equalSecond = await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_proj1', id: 'sub_p1', cancelAtPeriodEnd: true }),
      eventCreated: T0,
      eventId: 'evt_p1_equal',
    });

    expect(equalSecond).toEqual({ applied: true, kind: 'updated' });

    // STRICTLY older: stale, no write.
    const older = await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_proj1', id: 'sub_p1', cancelAtPeriodEnd: false }),
      eventCreated: new Date(T0.getTime() - 1000),
      eventId: 'evt_p1_old',
    });

    expect(older).toEqual({ applied: true, kind: 'stale' });

    const [after] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_p1'));

    expect(after!.cancelAtPeriodEnd).toBe(true);
  });

  it('unknown metadata is an anomaly, never a state write', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    const outcome = await projectSubscriptionSnapshot({
      snapshot: {
        id: 'sub_anom',
        customerId: 'cus_a',
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodStart: T0,
        metadata: { salonId: 's_missing', billingOfferKey: 'not_a_real_offer' },
      },
      eventCreated: T0,
      eventId: 'evt_anom',
    });

    expect(outcome).toEqual({ applied: false, anomaly: 'UNKNOWN_OFFER_OR_SALON_METADATA' });

    const rows = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_anom'));

    expect(rows).toHaveLength(0);
  });

  // FE-3 (D19c §2.3 item 3): the salon binding is METADATA, and on a shared
  // Stripe account it can name a salon that exists in another deployment's
  // database and nowhere here. That must be a classification, never a foreign
  // key error thrown into the webhook's retry ladder.
  it('a salonId with no salon row is SALON_NOT_LOCAL — never an FK throw, never a write', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    const outcome = await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_belongs_to_another_deployment', id: 'sub_not_local' }),
      eventCreated: T0,
      eventId: 'evt_not_local',
    });

    expect(outcome).toEqual({ applied: false, anomaly: 'SALON_NOT_LOCAL' });

    const rows = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_not_local'));

    expect(rows).toHaveLength(0);

    // Zero writes anywhere: no audit row either, so an operator queue is not
    // polluted with somebody else's subscriptions.
    const audit = (await db.select().from(schema.auditLogSchema))
      .filter(row => row.salonId === 's_belongs_to_another_deployment');

    expect(audit).toHaveLength(0);
  });

  it('a SOFT-DELETED salon is not local either — no entitlement is projected onto a deleted salon', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    await db.insert(schema.salonSchema).values({
      id: 's_proj_deleted',
      name: 's_proj_deleted',
      slug: 's_proj_deleted',
      deletedAt: T0,
    });
    const outcome = await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_proj_deleted', id: 'sub_proj_deleted' }),
      eventCreated: T0,
      eventId: 'evt_proj_deleted',
    });

    expect(outcome).toEqual({ applied: false, anomaly: 'SALON_NOT_LOCAL' });

    const rows = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_proj_deleted'));

    expect(rows).toHaveLength(0);
  });

  // The UPDATE path is reached only when a local row already exists, and that
  // row's own foreign key proves its salon — so an existing subscription keeps
  // projecting exactly as before, with no second lookup.
  it('an EXISTING local subscription still projects updates without re-testing the salon', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    await seedSalon('s_proj_existing');
    await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_proj_existing', id: 'sub_proj_existing' }),
      eventCreated: T0,
      eventId: 'evt_proj_existing_create',
    });
    const updated = await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_proj_existing', id: 'sub_proj_existing', status: 'past_due' }),
      eventCreated: T0_PLUS_MONTH,
      eventId: 'evt_proj_existing_update',
    });

    expect(updated).toEqual({ applied: true, kind: 'updated' });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_proj_existing'));

    expect(row!.status).toBe('past_due');
  });

  it('invoice success extends paid_through monotonically and only the ENGINE grants', async () => {
    const { projectSubscriptionSnapshot, applyInvoicePaymentSucceeded } = await projection();
    await seedSalon('s_proj2');
    await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_proj2', id: 'sub_p2' }),
      eventCreated: T0,
      eventId: 'evt_p2_create',
    });

    expect(await monthlyLedger('s_proj2')).toBe(0); // nothing before payment

    const paid = await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_p2',
      paidPeriodEnd: T0_PLUS_MONTH,
      eventCreated: new Date(T0.getTime() + 1000),
      eventId: 'evt_p2_paid',
      now: new Date(T0.getTime() + 2000),
    });

    expect(paid.applied).toBe(true);
    // Pro monthly allowance granted exactly once, BY THE ENGINE.
    expect(await monthlyLedger('s_proj2')).toBe(400);

    // Replay and an out-of-order shorter period: identity, no double grant.
    await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_p2',
      paidPeriodEnd: T0_PLUS_MONTH,
      eventCreated: new Date(T0.getTime() + 1000),
      eventId: 'evt_p2_paid',
      now: new Date(T0.getTime() + 3000),
    });
    await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_p2',
      paidPeriodEnd: new Date(T0.getTime() + 5 * 24 * 3600_000),
      eventCreated: new Date(T0.getTime() + 500),
      eventId: 'evt_p2_paid_old',
      now: new Date(T0.getTime() + 4000),
    });
    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_p2'));

    expect(row!.paidThrough.getTime()).toBe(T0_PLUS_MONTH.getTime());
    expect(await monthlyLedger('s_proj2')).toBe(400);
  });

  it('a downgrade parks as pending and applies at the next renewal invoice', async () => {
    const { projectSubscriptionSnapshot, applyInvoicePaymentSucceeded } = await projection();
    await seedSalon('s_proj3');
    await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_proj3', id: 'sub_p3' }),
      eventCreated: T0,
      eventId: 'evt_p3_create',
    });
    // Downgrade pro -> starter arrives mid-window.
    const downgraded = await projectSubscriptionSnapshot({
      snapshot: {
        ...snapshot({ salonId: 's_proj3', id: 'sub_p3' }),
        metadata: { salonId: 's_proj3', billingOfferKey: 'starter_2026_08_monthly' },
      },
      eventCreated: new Date(T0.getTime() + 1000),
      eventId: 'evt_p3_down',
    });

    expect(downgraded).toEqual({ applied: true, kind: 'updated' });

    let [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_p3'));

    expect(row!.billingOfferKey).toBe('pro_2026_08_monthly'); // unchanged mid-window
    expect(row!.pendingOfferKey).toBe('starter_2026_08_monthly');

    await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_p3',
      paidPeriodEnd: T0_PLUS_MONTH,
      eventCreated: new Date(T0.getTime() + 2000),
      eventId: 'evt_p3_renewal',
    });
    [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_p3'));

    expect(row!.billingOfferKey).toBe('starter_2026_08_monthly');
    expect(row!.pendingOfferKey).toBeNull();

    // G15/§3.9: the pending key was mapped through resolveOfferForServicePeriod
    // — servicePeriodStart is the PRE-UPDATE paid_through boundary (this
    // subscription's original activation, T0; no promotion ⇒ no protection).
    // Today the committed catalogue retires no offer, so the resolved key is
    // IDENTICAL to the raw pending key above — that is the point: wiring the
    // resolver in changes nothing yet.
    expect(rateProtectionHolder.calls).toContainEqual({
      currentOfferKey: 'starter_2026_08_monthly',
      rateProtectedThrough: null,
      servicePeriodStart: T0,
    });
  });
});

describe('G02 — Stripe Price ↔ offer-metadata cross-check', () => {
  it('an unconfigured price map (reverse lookup null) never holds and logs AT MOST ONCE per process, not per event', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    await seedSalon('s_price_unconf_1');
    await seedSalon('s_price_unconf_2');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      // priceMapHolder.resolvedOfferKey stays null (the REAL, all-placeholder
      // behaviour) — two DISTINCT subscriptions (one live subscription per
      // salon is enforced), each carrying a price id.
      const first = await projectSubscriptionSnapshot({
        snapshot: snapshot({ salonId: 's_price_unconf_1', id: 'sub_price_unconf_1', priceId: 'price_unresolvable_1' }),
        eventCreated: T0,
        eventId: 'evt_price_unconf_1',
      });
      const second = await projectSubscriptionSnapshot({
        snapshot: snapshot({ salonId: 's_price_unconf_2', id: 'sub_price_unconf_2', priceId: 'price_unresolvable_2' }),
        eventCreated: T0,
        eventId: 'evt_price_unconf_2',
      });

      expect(first).toEqual({ applied: true, kind: 'created' });
      expect(second).toEqual({ applied: true, kind: 'created' });
      expect(infoSpy).toHaveBeenCalledTimes(1);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('a CONFIGURED map resolving a DIFFERENT offer than metadata claims is a held anomaly, never a state write', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    await seedSalon('s_price_mismatch');
    priceMapHolder.resolvedOfferKey = 'elite_2026_08_monthly'; // metadata says pro_2026_08_monthly

    const outcome = await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_price_mismatch', id: 'sub_price_mismatch', priceId: 'price_configured_elite' }),
      eventCreated: T0,
      eventId: 'evt_price_mismatch',
    });

    expect(outcome).toEqual({ applied: false, anomaly: 'PRICE_OFFER_MISMATCH' });

    const rows = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_price_mismatch'));

    expect(rows).toHaveLength(0);
  });

  it('a CONFIGURED map resolving the SAME offer as metadata is not an anomaly', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    await seedSalon('s_price_match');
    priceMapHolder.resolvedOfferKey = 'pro_2026_08_monthly'; // matches metadata

    const outcome = await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_price_match', id: 'sub_price_match', priceId: 'price_configured_pro' }),
      eventCreated: T0,
      eventId: 'evt_price_match',
    });

    expect(outcome).toEqual({ applied: true, kind: 'created' });
  });
});

describe('G10 — full subscription refund stops future grants (§6.7)', () => {
  async function seedActiveSubscription(salonId: string, over: Partial<typeof schema.billingSubscriptionSchema.$inferInsert> = {}) {
    await seedSalon(salonId);
    const id = `bsub_${salonId}`;
    await db.insert(schema.billingSubscriptionSchema).values({
      id,
      salonId,
      stripeSubscriptionId: `sub_${salonId}`,
      stripeCustomerId: `cus_${salonId}`,
      planDefinitionKey: 'pro_2026_08',
      billingOfferKey: 'pro_2026_08_monthly',
      billingCadence: 'monthly',
      status: 'active',
      paidThrough: T0_PLUS_MONTH,
      creditCycleAnchor: T0,
      ...over,
    });
    return id;
  }

  it('lowers paid_through to the refunded period start and NEVER raises it', async () => {
    const { applySubscriptionFullRefund } = await projection();
    await seedActiveSubscription('s_refund_lower');
    const refundedPeriodStart = T0; // strictly before the seeded paid_through

    const result = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_refund_lower',
      refundId: 're_lower_1',
      invoiceId: 'in_refund_test',
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z'),
      refundedPeriodStart,
      eventCreated: T0,
      eventId: 'evt_refund_lower',
    });

    expect(result).toEqual({ applied: true, lowered: true });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_s_refund_lower'));

    expect(row!.paidThrough.getTime()).toBe(refundedPeriodStart.getTime());

    // A HIGHER refundedPeriodStart than the current paid_through must never raise it.
    const raiseAttempt = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_refund_lower',
      refundId: 're_lower_2',
      invoiceId: 'in_refund_test',
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z'),
      refundedPeriodStart: T0_PLUS_MONTH,
      eventCreated: T0,
      eventId: 'evt_refund_raise_attempt',
    });

    expect(raiseAttempt).toEqual({ applied: true, lowered: false });

    const [afterRaiseAttempt] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_s_refund_lower'));

    expect(afterRaiseAttempt!.paidThrough.getTime()).toBe(refundedPeriodStart.getTime());
  });

  it('replaying the SAME refund (or an equal/older evidence) is a pure no-op', async () => {
    const { applySubscriptionFullRefund } = await projection();
    await seedActiveSubscription('s_refund_replay');

    const first = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_refund_replay',
      refundId: 're_replay_1',
      invoiceId: 'in_refund_test',
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z'),
      refundedPeriodStart: T0,
      eventCreated: T0,
      eventId: 'evt_refund_replay_1',
    });

    expect(first).toEqual({ applied: true, lowered: true });

    // Same refund id, replayed — and even a SECOND, unrelated event carrying
    // the identical evidence — both converge to a no-op.
    const replay = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_refund_replay',
      refundId: 're_replay_1',
      invoiceId: 'in_refund_test',
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z'),
      refundedPeriodStart: T0,
      eventCreated: T0,
      eventId: 'evt_refund_replay_1_retry',
    });
    const secondEvent = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_refund_replay',
      refundId: 're_replay_2',
      invoiceId: 'in_refund_test',
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z'),
      refundedPeriodStart: T0,
      eventCreated: T0,
      eventId: 'evt_refund_replay_2',
    });

    expect(replay).toEqual({ applied: true, lowered: false });
    expect(secondEvent).toEqual({ applied: true, lowered: false });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_s_refund_replay'));

    expect(row!.paidThrough.getTime()).toBe(T0.getTime());
  });

  it('a missing subscription is a clean no-op, never an error', async () => {
    const { applySubscriptionFullRefund } = await projection();
    const result = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_does_not_exist',
      refundId: 're_missing',
      invoiceId: 'in_refund_test',
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z'),
      refundedPeriodStart: T0,
      eventCreated: T0,
      eventId: 'evt_refund_missing',
    });

    expect(result).toEqual({ applied: false, lowered: false });
  });

  it('a window ALREADY granted before the refund stays granted; the NEXT window records skipped_unpaid instead of being granted (§6.8: full refund after prior windows consumed)', async () => {
    const { projectSubscriptionSnapshot, applyInvoicePaymentSucceeded, applySubscriptionFullRefund } = await projection();
    const { evaluateSubscriptionWindows } = await import('./creditGrants');
    await seedSalon('s_refund_window');
    await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_refund_window', id: 'sub_refund_window' }),
      eventCreated: T0,
      eventId: 'evt_refund_window_create',
    });
    const twoMonthsOut = new Date('2026-11-01T10:00:00.000Z');
    // Paid two full months upfront: covers window 0 [T0, T0+1mo) AND
    // window 1 [T0+1mo, T0+2mo) fully.
    await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_refund_window',
      paidPeriodEnd: twoMonthsOut,
      eventCreated: new Date(T0.getTime() + 1000),
      eventId: 'evt_refund_window_paid',
      now: new Date(T0.getTime() + 15 * 24 * 3600_000), // inside window 0 — grants it
    });

    const [subscriptionAfterWindow0] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_refund_window'));
    const windowsAfterWindow0 = await db.select().from(schema.billingCreditWindowSchema)
      .where(eq(schema.billingCreditWindowSchema.billingSubscriptionId, subscriptionAfterWindow0!.id));

    expect(windowsAfterWindow0).toHaveLength(1);
    expect(windowsAfterWindow0[0]).toMatchObject({ creditCycleIndex: 0, status: 'granted' });

    // Full refund covers exactly window 1's allowance: paid_through drops
    // back to window 1's start (T0_PLUS_MONTH), leaving window 0 untouched.
    const refundResult = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_refund_window',
      refundId: 're_window_1',
      invoiceId: 'in_refund_test',
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z'),
      refundedPeriodStart: T0_PLUS_MONTH,
      eventCreated: new Date(T0.getTime() + 2000),
      eventId: 'evt_refund_window_refund',
    });

    expect(refundResult).toEqual({ applied: true, lowered: true });

    // Evaluate again from inside window 1's range: it must record
    // skipped_unpaid, NOT granted — even though paid_through covered it
    // before the refund. Window 0's grant is untouched (never clawed back).
    const summary = await evaluateSubscriptionWindows({
      subscriptionId: subscriptionAfterWindow0!.id,
      now: new Date(T0.getTime() + 45 * 24 * 3600_000), // inside window 1
    });

    expect(summary.skippedUnpaid).toBe(1);
    expect(summary.granted).toBe(0);

    const windowsAfterRefund = await db.select().from(schema.billingCreditWindowSchema)
      .where(eq(schema.billingCreditWindowSchema.billingSubscriptionId, subscriptionAfterWindow0!.id));
    const window0 = windowsAfterRefund.find(w => w.creditCycleIndex === 0);
    const window1 = windowsAfterRefund.find(w => w.creditCycleIndex === 1);

    expect(window0).toMatchObject({ status: 'granted' }); // prior grant untouched
    expect(window1).toMatchObject({ status: 'skipped_unpaid' });

    // The purchased/granted monthly total reflects ONLY window 0's 400
    // credits — the refund prevented window 1 from ever minting its own.
    expect(await monthlyLedger('s_refund_window')).toBe(400);
  });
});

describe('founding effects are gated on PAID evidence (§3.9)', () => {
  it('an unpaid checkout completion redeems nothing; the first paid invoice redeems and starts protection ONCE', async () => {
    const {
      projectSubscriptionSnapshot,
      applyInvoicePaymentSucceeded,
      applyCheckoutSessionCompleted,
    } = await projection();
    const { reservePromotionClaim } = await import('./promotionClaims');
    const { resolveOrCreateBusinessIdentity } = await import('./businessIdentity');
    await seedSalon('s_found');

    const identityId = await db.transaction(async (tx) => {
      const identity = await resolveOrCreateBusinessIdentity(tx, { salonId: 's_found' });
      return identity.businessIdentityId;
    });
    await db.transaction(async (tx) => {
      const claim = await reservePromotionClaim(tx, {
        promotionKey: 'founding_annual_2026',
        businessIdentityId: identityId,
        salonId: 's_found',
        promotionOverride: {
          key: 'founding_annual_2026',
          eligibleOfferKeys: ['pro_2026_08_annual'],
          percentOffAgainstAnnualPrice: 40,
          duration: 'once',
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: null,
          maximumRedemptions: null,
          rateProtectionMonths: 24,
        },
      });
      if (!claim.ok) {
        throw new Error('seed claim failed');
      }
      await tx.update(schema.billingPromotionClaimSchema)
        .set({ stripeCheckoutSessionId: 'cs_found' })
        .where(eq(schema.billingPromotionClaimSchema.id, claim.claimId));
    });

    // UNPAID async completion: attempt may complete, the claim must NOT.
    await applyCheckoutSessionCompleted({ sessionId: 'cs_found', paymentStatus: 'unpaid' });
    let [claim] = await db.select().from(schema.billingPromotionClaimSchema);

    expect(claim!.status).toBe('reserved');

    await projectSubscriptionSnapshot({
      snapshot: {
        ...snapshot({ salonId: 's_found', id: 'sub_found' }),
        metadata: {
          salonId: 's_found',
          billingOfferKey: 'pro_2026_08_annual',
          promotionKey: 'founding_annual_2026',
        },
      },
      eventCreated: T0,
      eventId: 'evt_found_create',
    });
    let [subscription] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_found'));

    expect(subscription!.rateProtectedThrough).toBeNull(); // no paid evidence yet

    // First PAID invoice: protection clock starts once, claim redeems.
    const firstPaidAt = new Date('2026-09-01T12:00:00.000Z');
    await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_found',
      paidPeriodEnd: new Date('2027-09-01T10:00:00.000Z'),
      eventCreated: firstPaidAt,
      eventId: 'evt_found_paid',
      now: firstPaidAt,
    });
    [subscription] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_found'));
    [claim] = await db.select().from(schema.billingPromotionClaimSchema);

    expect(subscription!.rateProtectedThrough?.toISOString()).toBe('2028-09-01T12:00:00.000Z');
    expect(claim!.status).toBe('redeemed');

    // A later renewal must NOT move the protection clock.
    await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_found',
      paidPeriodEnd: new Date('2028-09-01T10:00:00.000Z'),
      eventCreated: new Date('2027-09-01T12:00:00.000Z'),
      eventId: 'evt_found_renewal',
      now: new Date('2027-09-01T12:00:00.000Z'),
    });
    [subscription] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_found'));

    expect(subscription!.rateProtectedThrough?.toISOString()).toBe('2028-09-01T12:00:00.000Z');
  });
});

describe('annual renewal failure (§6.8, §8.4)', () => {
  it('invoice.payment_failed on an annual renewal sets past_due, leaves paid_through UNTOUCHED, and the engine grants nothing beyond it', async () => {
    const { projectSubscriptionSnapshot, applyInvoicePaymentSucceeded, applyInvoicePaymentFailed } = await projection();
    const { evaluateSubscriptionWindows } = await import('./creditGrants');
    await seedSalon('s_annual_fail');

    await projectSubscriptionSnapshot({
      snapshot: {
        ...snapshot({ salonId: 's_annual_fail', id: 'sub_annual_fail' }),
        metadata: { salonId: 's_annual_fail', billingOfferKey: 'pro_2026_08_annual' },
      },
      eventCreated: T0,
      eventId: 'evt_af_create',
    });

    // The first annual term is paid in full — one year of entitlement.
    const firstTermEnd = new Date('2027-09-01T10:00:00.000Z');
    await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_annual_fail',
      paidPeriodEnd: firstTermEnd,
      eventCreated: new Date(T0.getTime() + 1000),
      eventId: 'evt_af_paid',
      now: new Date(T0.getTime() + 1000),
    });

    let [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_annual_fail'));

    expect(row!.paidThrough.getTime()).toBe(firstTermEnd.getTime());

    // A year later, the ANNUAL RENEWAL invoice fails.
    const renewalAttempt = new Date('2027-09-01T11:00:00.000Z');
    const failed = await applyInvoicePaymentFailed({
      stripeSubscriptionId: 'sub_annual_fail',
      eventCreated: renewalAttempt,
      eventId: 'evt_af_failed',
    });

    expect(failed.applied).toBe(true);

    [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_annual_fail'));

    expect(row!.status).toBe('past_due');
    // paid_through is entitlement math and is never touched by a failure.
    expect(row!.paidThrough.getTime()).toBe(firstTermEnd.getTime());

    // The window engine — the ONLY granter — must not extend entitlement
    // past the (unchanged) paid_through boundary.
    const summary = await evaluateSubscriptionWindows({
      subscriptionId: row!.id,
      now: new Date('2027-09-05T00:00:00.000Z'),
    });

    expect(summary.granted).toBe(0);
  });
});

describe('§2.3 duplicate-subscription policy', () => {
  it('classifies active, cancel-scheduled, canceled-but-prepaid and expired shapes', async () => {
    const { classifySubscriptionEligibility } = await projection();
    const now = new Date('2026-09-15T00:00:00.000Z');
    const seedSub = async (salonId: string, over: Partial<typeof schema.billingSubscriptionSchema.$inferInsert>) => {
      await seedSalon(salonId);
      await db.insert(schema.billingSubscriptionSchema).values({
        id: `bsub_${salonId}`,
        salonId,
        stripeSubscriptionId: `sub_${salonId}`,
        stripeCustomerId: `cus_${salonId}`,
        planDefinitionKey: 'pro_2026_08',
        billingOfferKey: 'pro_2026_08_monthly',
        billingCadence: 'monthly',
        status: 'active',
        paidThrough: new Date('2026-10-01T00:00:00.000Z'),
        creditCycleAnchor: T0,
        ...over,
      });
    };

    await seedSub('s_el_active', {});
    await seedSub('s_el_sched', { cancelAtPeriodEnd: true });
    await seedSub('s_el_prepaid', { status: 'canceled' });
    await seedSub('s_el_done', { status: 'canceled', paidThrough: new Date('2026-09-01T00:00:00.000Z') });
    await seedSalon('s_el_none');

    await db.transaction(async (tx) => {
      expect(await classifySubscriptionEligibility(tx, 's_el_active', now))
        .toEqual({ eligible: false, reason: 'ACTIVE_SUBSCRIPTION_EXISTS' });
      expect(await classifySubscriptionEligibility(tx, 's_el_sched', now))
        .toEqual({ eligible: false, reason: 'CANCELLATION_SCHEDULED' });
      expect(await classifySubscriptionEligibility(tx, 's_el_prepaid', now))
        .toEqual({ eligible: false, reason: 'PREPAID_ENTITLEMENT_REMAINS', paidThrough: new Date('2026-10-01T00:00:00.000Z') });
      expect(await classifySubscriptionEligibility(tx, 's_el_done', now))
        .toEqual({ eligible: true });
      expect(await classifySubscriptionEligibility(tx, 's_el_none', now))
        .toEqual({ eligible: true });
    });
  });
});

describe('P3c — audit trail (§8.5, §17)', () => {
  const auditRowsForEntity = (entityId: string) =>
    db.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.entityId, entityId));
  const attempts = () => import('./checkoutAttempts');

  it('projectSubscriptionSnapshot writes one billing_subscription_projected row per applied outcome, tagged with kind', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    await seedSalon('s_audit_proj');

    const created = await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_audit_proj', id: 'sub_audit_proj' }),
      eventCreated: T0,
      eventId: 'evt_audit_created',
    });

    expect(created).toMatchObject({ applied: true, kind: 'created' });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_audit_proj'));
    const subscriptionId = row!.id;

    let rows = await auditRowsForEntity(subscriptionId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      salonId: 's_audit_proj',
      actorType: 'webhook',
      actorId: 'stripe-billing',
      action: 'billing_subscription_projected',
    });
    expect(rows[0]!.metadata).toMatchObject({ kind: 'created' });

    // Equal-second event with a status change ⇒ 'updated'.
    await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_audit_proj', id: 'sub_audit_proj', status: 'past_due' }),
      eventCreated: T0,
      eventId: 'evt_audit_updated',
    });
    rows = await auditRowsForEntity(subscriptionId);

    expect(rows).toHaveLength(2);
    expect(rows[1]!.metadata).toMatchObject({ kind: 'updated' });

    // Strictly-older event ⇒ 'stale', still one row.
    await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_audit_proj', id: 'sub_audit_proj', status: 'active' }),
      eventCreated: new Date(T0.getTime() - 1000),
      eventId: 'evt_audit_stale',
    });
    rows = await auditRowsForEntity(subscriptionId);

    expect(rows).toHaveLength(3);
    expect(rows[2]!.metadata).toMatchObject({ kind: 'stale' });
  });

  it('projectSubscriptionSnapshot accepts an optional actor override, defaulting to the webhook actor', async () => {
    const { projectSubscriptionSnapshot } = await projection();
    await seedSalon('s_audit_actor1');
    await seedSalon('s_audit_actor2');

    await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_audit_actor1', id: 'sub_audit_actor1' }),
      eventCreated: T0,
      eventId: 'evt_audit_actor_default',
    });
    const [defaultRow] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_audit_actor1'));
    const defaultRows = await auditRowsForEntity(defaultRow!.id);

    expect(defaultRows[0]).toMatchObject({ actorType: 'webhook', actorId: 'stripe-billing' });

    // P4's reconciliation cron will reuse this same projection with its own
    // actor once that caller exists — the seam is proven here.
    await projectSubscriptionSnapshot({
      snapshot: snapshot({ salonId: 's_audit_actor2', id: 'sub_audit_actor2' }),
      eventCreated: T0,
      eventId: 'evt_audit_actor_override',
      actor: { actorType: 'system', actorId: 'billing-reconciliation' },
    });
    const [overrideRow] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_audit_actor2'));
    const overrideRows = await auditRowsForEntity(overrideRow!.id);

    expect(overrideRows[0]).toMatchObject({ actorType: 'system', actorId: 'billing-reconciliation' });
  });

  it('applySubscriptionFullRefund records durable refund evidence once per invoice', async () => {
    const { applySubscriptionFullRefund } = await projection();
    await seedSalon('s_audit_refund');
    const subscriptionId = 'bsub_audit_refund';
    await db.insert(schema.billingSubscriptionSchema).values({
      id: subscriptionId,
      salonId: 's_audit_refund',
      stripeSubscriptionId: 'sub_audit_refund',
      stripeCustomerId: 'cus_audit_refund',
      planDefinitionKey: 'pro_2026_08',
      billingOfferKey: 'pro_2026_08_monthly',
      billingCadence: 'monthly',
      status: 'active',
      paidThrough: T0_PLUS_MONTH,
      creditCycleAnchor: T0,
    });

    const lowered = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_audit_refund',
      refundId: 're_audit_1',
      invoiceId: 'in_refund_test',
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z'),
      refundedPeriodStart: T0,
      eventCreated: T0,
      eventId: 'evt_audit_refund_1',
    });

    expect(lowered).toEqual({ applied: true, lowered: true });

    let rows = await auditRowsForEntity(subscriptionId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      salonId: 's_audit_refund',
      actorType: 'webhook',
      actorId: 'stripe-billing',
      action: 'billing_subscription_refund_applied',
    });
    // PR-1: the v2 evidence shape. `seq` is the per-subscription order the
    // reader resolves corrections by; `refundIds` replaces the single
    // `refundId` (a charge can carry several refunds) and is informational.
    expect(rows[0]!.metadata).toEqual({
      evidenceVersion: 2,
      seq: 1,
      invoiceId: 'in_refund_test',
      refundIds: ['re_audit_1'],
      eventId: 'evt_audit_refund_1',
      refundedPeriodStart: T0.toISOString(),
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z').toISOString(),
    });

    // Already at the refunded floor ⇒ lowered:false ⇒ NO second row.
    const replay = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_audit_refund',
      refundId: 're_audit_2',
      invoiceId: 'in_refund_test',
      refundedPeriodEnd: new Date('2027-10-01T10:00:00.000Z'),
      refundedPeriodStart: T0,
      eventCreated: T0,
      eventId: 'evt_audit_refund_2',
    });

    expect(replay).toEqual({ applied: true, lowered: false });

    rows = await auditRowsForEntity(subscriptionId);

    expect(rows).toHaveLength(1);
  });

  it('applyCheckoutSessionCompleted / applyCheckoutSessionExpired write the SAME shared attempt-lifecycle rows as the checkout route', async () => {
    const { applyCheckoutSessionCompleted, applyCheckoutSessionExpired } = await projection();
    const { beginCheckoutAttempt, markAttemptCheckoutCreated } = await attempts();
    await seedSalon('s_audit_cs');

    const begun = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_audit_cs', purpose: 'plan_subscription', billingOfferKey: 'starter_2026_08_monthly' }));
    const attemptId = (begun as { attemptId: string }).attemptId;
    await db.transaction(async tx =>
      markAttemptCheckoutCreated(tx, { attemptId, stripeCheckoutSessionId: 'cs_audit_complete' }));

    await applyCheckoutSessionCompleted({ sessionId: 'cs_audit_complete', paymentStatus: 'unpaid' });

    const completedRows = (await auditRowsForEntity(attemptId))
      .filter(row => row.action === 'billing_checkout_attempt_completed');

    expect(completedRows).toHaveLength(1);

    // A second attempt on the same salon exercises expiry.
    const begun2 = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_audit_cs', purpose: 'plan_subscription', billingOfferKey: 'starter_2026_08_monthly' }));
    const attemptId2 = (begun2 as { attemptId: string }).attemptId;
    await db.transaction(async tx =>
      markAttemptCheckoutCreated(tx, { attemptId: attemptId2, stripeCheckoutSessionId: 'cs_audit_expire' }));

    const result = await applyCheckoutSessionExpired({ sessionId: 'cs_audit_expire' });

    expect(result.attemptExpired).toBe(true);

    const expiredRows = (await auditRowsForEntity(attemptId2))
      .filter(row => row.action === 'billing_checkout_attempt_expired');

    expect(expiredRows).toHaveLength(1);
  });
});

// =============================================================================
// PR-1 — refund completion (R-1..R-5, R-8)
// =============================================================================

const REFUND_WINDOW_END = new Date('2026-12-01T10:00:00.000Z');

async function seedSubscription(
  salonId: string,
  over: Partial<typeof schema.billingSubscriptionSchema.$inferInsert> = {},
) {
  await seedSalon(salonId);
  const id = `bsub_${salonId}`;
  await db.insert(schema.billingSubscriptionSchema).values({
    id,
    salonId,
    stripeSubscriptionId: `sub_${salonId}`,
    stripeCustomerId: `cus_${salonId}`,
    planDefinitionKey: 'pro_2026_08',
    billingOfferKey: 'pro_2026_08_monthly',
    billingCadence: 'monthly',
    status: 'active',
    paidThrough: T0_PLUS_MONTH,
    creditCycleAnchor: T0,
    ...over,
  });
  return id;
}

const evidenceRowsFor = (entityId: string) =>
  db.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.entityId, entityId));

const subscriptionRow = async (stripeSubscriptionId: string) => {
  const [row] = await db.select().from(schema.billingSubscriptionSchema)
    .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, stripeSubscriptionId));
  return row!;
};

/** Raw evidence, exactly as a historical (pre-PR-1) writer would have left it. */
async function seedRawEvidence(input: {
  id: string;
  salonId: string;
  entityId: string;
  action: 'billing_subscription_refund_applied' | 'billing_subscription_refund_evidence_resolved';
  metadata: Record<string, unknown>;
}) {
  await db.insert(schema.auditLogSchema).values({
    id: input.id,
    salonId: input.salonId,
    actorType: 'system',
    action: input.action,
    entityType: 'billing_subscription',
    entityId: input.entityId,
    metadata: input.metadata,
  });
}

describe('R-1/R-8 — refund coverage validity and v2 evidence', () => {
  it('unusable coverage is REFUSED before any write, instead of poisoning the evidence with null bounds', async () => {
    const { applySubscriptionFullRefund } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_invalid');

    const nanBounds = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_invalid',
      refundId: 're_1',
      invoiceId: 'in_1',
      refundedPeriodStart: new Date(Number.NaN),
      refundedPeriodEnd: new Date(Number.NaN),
      eventCreated: T0,
      eventId: 'evt_pr1_invalid_nan',
    });

    expect(nanBounds).toEqual({ applied: false, lowered: false, anomaly: 'REFUND_COVERAGE_INVALID' });

    const inverted = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_invalid',
      refundId: 're_2',
      invoiceId: 'in_1',
      refundedPeriodStart: T0_PLUS_MONTH,
      refundedPeriodEnd: T0,
      eventCreated: T0,
      eventId: 'evt_pr1_invalid_inverted',
    });

    expect(inverted).toEqual({ applied: false, lowered: false, anomaly: 'REFUND_COVERAGE_INVALID' });

    // ZERO writes: no evidence row, and paid_through untouched.
    expect(await evidenceRowsFor(subscriptionId)).toHaveLength(0);
    expect((await subscriptionRow('sub_s_pr1_invalid')).paidThrough.getTime()).toBe(T0_PLUS_MONTH.getTime());
  });

  it('records the v2 shape with the charge observations and every refund id', async () => {
    const { applySubscriptionFullRefund } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_v2');

    const result = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_v2',
      refundIds: ['re_a', 're_b'],
      refundId: 're_b', // duplicated on purpose: the legacy field folds in without repeating
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: REFUND_WINDOW_END,
      eventCreated: T0,
      eventId: 'evt_pr1_v2',
      observedAmountRefunded: 2400,
      observedAmount: 2400,
    });

    expect(result).toEqual({ applied: true, lowered: true });

    const rows = await evidenceRowsFor(subscriptionId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toEqual({
      evidenceVersion: 2,
      seq: 1,
      invoiceId: 'in_1',
      refundIds: ['re_a', 're_b'],
      eventId: 'evt_pr1_v2',
      refundedPeriodStart: T0.toISOString(),
      refundedPeriodEnd: REFUND_WINDOW_END.toISOString(),
      observedAmountRefunded: 2400,
      observedAmount: 2400,
    });
  });

  it('RT-12: two distinct events for ONE full refund write one row, and a malformed prior row still dedupes', async () => {
    const { applySubscriptionFullRefund } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_rt12');

    const first = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_rt12',
      refundIds: ['re_1'],
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: REFUND_WINDOW_END,
      eventCreated: T0,
      eventId: 'evt_rt12_charge_refunded',
    });
    // The SAME refund also arrives as refund.updated — a different event id.
    const second = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_rt12',
      refundIds: ['re_1'],
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: REFUND_WINDOW_END,
      eventCreated: T0,
      eventId: 'evt_rt12_refund_updated',
    });

    expect(first).toEqual({ applied: true, lowered: true });
    expect(second).toEqual({ applied: true, lowered: false });
    expect(await evidenceRowsFor(subscriptionId)).toHaveLength(1);

    // A MALFORMED historical row for a second invoice is still "refunded":
    // dedupe keys on the effective state, so no second row is written for it.
    await seedRawEvidence({
      id: 'audit_rt12_legacy',
      salonId: 's_pr1_rt12',
      entityId: subscriptionId,
      action: 'billing_subscription_refund_applied',
      metadata: { invoiceId: 'in_2' },
    });

    const overLegacy = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_rt12',
      refundIds: ['re_2'],
      invoiceId: 'in_2',
      refundedPeriodStart: T0,
      refundedPeriodEnd: REFUND_WINDOW_END,
      eventCreated: T0,
      eventId: 'evt_rt12_legacy_replay',
    });

    expect(overLegacy).toEqual({ applied: true, lowered: false });
    expect(await evidenceRowsFor(subscriptionId)).toHaveLength(2); // the seeded legacy row + the first
  });
});

describe('R-3 — RT-8: PAID_PERIOD_START_UNKNOWN only when refunds exist', () => {
  it('with NO refund evidence an unknown paid-period start still applies', async () => {
    const { applyInvoicePaymentSucceeded } = await projection();
    await seedSubscription('s_pr1_rt8_clean', { paidThrough: T0 });

    const outcome = await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_s_pr1_rt8_clean',
      invoiceId: 'in_1',
      paidPeriodEnd: T0_PLUS_MONTH,
      eventCreated: T0,
      eventId: 'evt_rt8_clean',
      now: T0,
    });

    expect(outcome).toEqual({ applied: true });
    expect((await subscriptionRow('sub_s_pr1_rt8_clean')).paidThrough.getTime()).toBe(T0_PLUS_MONTH.getTime());
  });

  it('with refunds on record an unknown start is its own anomaly, never an epoch-min overlap', async () => {
    const { applyInvoicePaymentSucceeded, applySubscriptionFullRefund } = await projection();
    await seedSubscription('s_pr1_rt8_refunded', { paidThrough: T0_PLUS_MONTH });
    await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_rt8_refunded',
      refundIds: ['re_1'],
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: T0_PLUS_MONTH,
      eventCreated: T0,
      eventId: 'evt_rt8_refund',
    });

    const unknownStart = await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_s_pr1_rt8_refunded',
      invoiceId: 'in_2',
      paidPeriodEnd: REFUND_WINDOW_END,
      eventCreated: T0,
      eventId: 'evt_rt8_unknown',
      now: T0,
    });

    expect(unknownStart).toEqual({ applied: false, anomaly: 'PAID_PERIOD_START_UNKNOWN' });

    // The SAME invoice with a known, DISJOINT period applies normally — the
    // old epoch-min default would have held it forever.
    const known = await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_s_pr1_rt8_refunded',
      invoiceId: 'in_2',
      paidPeriodStart: T0_PLUS_MONTH,
      paidPeriodEnd: REFUND_WINDOW_END,
      eventCreated: T0,
      eventId: 'evt_rt8_known',
      now: T0,
    });

    expect(known).toEqual({ applied: true });
    expect((await subscriptionRow('sub_s_pr1_rt8_refunded')).paidThrough.getTime()).toBe(REFUND_WINDOW_END.getTime());
  });

  it('the refunded invoice itself is excluded even when its own period looks disjoint', async () => {
    const { applyInvoicePaymentSucceeded, applySubscriptionFullRefund } = await projection();
    await seedSubscription('s_pr1_rt8_self', { paidThrough: T0 });
    await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_rt8_self',
      refundIds: ['re_1'],
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: T0_PLUS_MONTH,
      eventCreated: T0,
      eventId: 'evt_rt8_self_refund',
    });

    const replay = await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_s_pr1_rt8_self',
      invoiceId: 'in_1',
      paidPeriodStart: T0_PLUS_MONTH,
      paidPeriodEnd: REFUND_WINDOW_END,
      eventCreated: T0,
      eventId: 'evt_rt8_self_replay',
      now: T0,
    });

    expect(replay).toEqual({ applied: false, anomaly: 'SUBSCRIPTION_PERIOD_REFUNDED' });
  });

  it('malformed evidence fails closed for every period', async () => {
    const { applyInvoicePaymentSucceeded } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_rt8_bad', { paidThrough: T0 });
    await seedRawEvidence({
      id: 'audit_rt8_bad',
      salonId: 's_pr1_rt8_bad',
      entityId: subscriptionId,
      action: 'billing_subscription_refund_applied',
      metadata: { invoiceId: 'in_bad' },
    });

    const outcome = await applyInvoicePaymentSucceeded({
      stripeSubscriptionId: 'sub_s_pr1_rt8_bad',
      invoiceId: 'in_other',
      paidPeriodStart: T0_PLUS_MONTH,
      paidPeriodEnd: REFUND_WINDOW_END,
      eventCreated: T0,
      eventId: 'evt_rt8_bad',
      now: T0,
    });

    expect(outcome).toEqual({ applied: false, anomaly: 'SUBSCRIPTION_PERIOD_REFUNDED' });
  });
});

describe('R-5 — status fences', () => {
  it('a paid invoice RESUMES only a dunning/incomplete subscription; every other status is left alone', async () => {
    const { applyInvoicePaymentSucceeded } = await projection();
    const table: { status: typeof schema.billingSubscriptionSchema.$inferInsert.status; expected: string }[] = [
      { status: 'past_due', expected: 'active' },
      { status: 'unpaid', expected: 'active' },
      { status: 'incomplete', expected: 'active' },
      { status: 'active', expected: 'active' },
      { status: 'canceled', expected: 'canceled' },
      { status: 'incomplete_expired', expected: 'incomplete_expired' },
      { status: 'paused', expected: 'paused' },
      { status: 'trialing', expected: 'trialing' },
    ];

    for (const entry of table) {
      const salonId = `s_pr1_fence_${entry.status}`;
      await seedSubscription(salonId, { status: entry.status, paidThrough: T0 });

      const outcome = await applyInvoicePaymentSucceeded({
        stripeSubscriptionId: `sub_${salonId}`,
        invoiceId: 'in_1',
        paidPeriodStart: T0,
        paidPeriodEnd: T0_PLUS_MONTH,
        eventCreated: T0,
        eventId: `evt_fence_${entry.status}`,
        now: T0,
      });
      const row = await subscriptionRow(`sub_${salonId}`);

      expect(outcome).toEqual({ applied: true });
      expect(row.status).toBe(entry.expected);
      // Entitlement math is independent of the status fence.
      expect(row.paidThrough.getTime()).toBe(T0_PLUS_MONTH.getTime());
    }
  });

  it('invoice.payment_failed dunning table: only in-service statuses move to past_due', async () => {
    const { applyInvoicePaymentFailed } = await projection();
    const table: { status: typeof schema.billingSubscriptionSchema.$inferInsert.status; expected: string; changed: boolean }[] = [
      { status: 'active', expected: 'past_due', changed: true },
      { status: 'trialing', expected: 'past_due', changed: true },
      { status: 'unpaid', expected: 'past_due', changed: true },
      { status: 'past_due', expected: 'past_due', changed: false },
      { status: 'canceled', expected: 'canceled', changed: false },
      { status: 'incomplete_expired', expected: 'incomplete_expired', changed: false },
      { status: 'paused', expected: 'paused', changed: false },
      { status: 'incomplete', expected: 'incomplete', changed: false },
    ];

    for (const entry of table) {
      const salonId = `s_pr1_fail_${entry.status}`;
      await seedSubscription(salonId, { status: entry.status });

      const outcome = await applyInvoicePaymentFailed({
        stripeSubscriptionId: `sub_${salonId}`,
        eventCreated: new Date('2027-01-01T00:00:00.000Z'),
        eventId: `evt_fail_${entry.status}`,
      });

      expect(outcome).toEqual({ applied: true, changed: entry.changed });
      expect((await subscriptionRow(`sub_${salonId}`)).status).toBe(entry.expected);
    }
  });

  it('invoice.payment_failed NEVER raises the subscription-stream watermark, and a missing row is not applied', async () => {
    const { applyInvoicePaymentFailed } = await projection();
    const watermark = new Date('2026-09-01T09:00:00.000Z');
    await seedSubscription('s_pr1_fail_watermark', {
      status: 'active',
      lastEventCreated: watermark,
      lastEventId: 'evt_subscription_updated',
    });

    await applyInvoicePaymentFailed({
      stripeSubscriptionId: 'sub_s_pr1_fail_watermark',
      eventCreated: new Date('2027-01-01T00:00:00.000Z'),
      eventId: 'evt_invoice_failed',
    });
    const row = await subscriptionRow('sub_s_pr1_fail_watermark');

    expect(row.status).toBe('past_due');
    expect(row.lastEventCreated?.getTime()).toBe(watermark.getTime());
    expect(row.lastEventId).toBe('evt_subscription_updated');

    expect(await applyInvoicePaymentFailed({
      stripeSubscriptionId: 'sub_does_not_exist_at_all',
      eventCreated: T0,
      eventId: 'evt_fail_missing',
    })).toEqual({ applied: false, changed: false });
  });
});

describe('R-4 — applyPendingOfferAtRenewal', () => {
  it('applies the parked offer alone: no paid_through, no status, no evidence read', async () => {
    const { applyPendingOfferAtRenewal } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_pending', {
      status: 'past_due',
      pendingOfferKey: 'starter_2026_08_monthly',
      paidThrough: T0,
    });
    // Deliberately UNREADABLE refund evidence: a pending-offer repair must not
    // consult it at all, so this must not block the clearance.
    await seedRawEvidence({
      id: 'audit_pending_bad_evidence',
      salonId: 's_pr1_pending',
      entityId: subscriptionId,
      action: 'billing_subscription_refund_applied',
      metadata: { invoiceId: 'in_bad' },
    });

    const outcome = await applyPendingOfferAtRenewal({
      stripeSubscriptionId: 'sub_s_pr1_pending',
      now: T0,
      actor: { actorType: 'system', actorId: 'billing-reconcile' },
    });
    const row = await subscriptionRow('sub_s_pr1_pending');

    expect(outcome).toEqual({ applied: true, cleared: true });
    expect(row.billingOfferKey).toBe('starter_2026_08_monthly');
    expect(row.planDefinitionKey).toBe('starter_2026_08');
    expect(row.pendingOfferKey).toBeNull();
    // Untouched by design.
    expect(row.paidThrough.getTime()).toBe(T0.getTime());
    expect(row.status).toBe('past_due');

    const projected = (await evidenceRowsFor(subscriptionId))
      .filter(auditRow => auditRow.action === 'billing_subscription_projected');

    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ actorType: 'system', actorId: 'billing-reconcile' });
    expect(projected[0]!.metadata).toEqual({
      kind: 'pending_offer_applied',
      billingOfferKey: 'starter_2026_08_monthly',
    });
  });

  it('is a clean no-op with nothing parked, and reports a missing subscription', async () => {
    const { applyPendingOfferAtRenewal } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_pending_none');

    expect(await applyPendingOfferAtRenewal({ stripeSubscriptionId: 'sub_s_pr1_pending_none', now: T0 }))
      .toEqual({ applied: true, cleared: false });
    expect(await evidenceRowsFor(subscriptionId)).toHaveLength(0);
    expect(await applyPendingOfferAtRenewal({ stripeSubscriptionId: 'sub_missing_pending', now: T0 }))
      .toEqual({ applied: false, cleared: false });
  });
});

describe('R-2 — applySubscriptionRefundVoid', () => {
  it('nothing to void is never an error and writes nothing', async () => {
    const { applySubscriptionRefundVoid } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_void_none');

    expect(await applySubscriptionRefundVoid({
      stripeSubscriptionId: 'sub_s_pr1_void_none',
      invoiceId: 'in_1',
      reason: 'refund_reversed:refund.updated',
      observedAmountRefunded: 0,
      observedAmount: 2400,
    })).toEqual({ applied: true, voided: false, reapplied: false });

    expect(await evidenceRowsFor(subscriptionId)).toHaveLength(0);
    expect(await applySubscriptionRefundVoid({
      stripeSubscriptionId: 'sub_missing_void',
      invoiceId: 'in_1',
      reason: 'refund_reversed:refund.updated',
      observedAmountRefunded: 0,
      observedAmount: 2400,
    })).toEqual({ applied: false, voided: false, reapplied: false });
  });

  it('voids live evidence, re-establishes paid_through from the captured coverage, and is idempotent', async () => {
    const { applySubscriptionFullRefund, applySubscriptionRefundVoid } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_void_live', { paidThrough: T0_PLUS_MONTH });
    await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_void_live',
      refundIds: ['re_1'],
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: T0_PLUS_MONTH,
      eventCreated: T0,
      eventId: 'evt_void_live_refund',
    });

    expect((await subscriptionRow('sub_s_pr1_void_live')).paidThrough.getTime()).toBe(T0.getTime());

    const voided = await applySubscriptionRefundVoid({
      stripeSubscriptionId: 'sub_s_pr1_void_live',
      invoiceId: 'in_1',
      reason: 'refund_reversed:failed',
      eventId: 'evt_void_live',
      observedAmountRefunded: 0,
      observedAmount: 2400,
      now: T0,
    });

    expect(voided).toEqual({ applied: true, voided: true, reapplied: true });
    // The coverage captured before the void is replayed through the ordinary
    // payment transition, so entitlement comes back exactly where it was.
    expect((await subscriptionRow('sub_s_pr1_void_live')).paidThrough.getTime()).toBe(T0_PLUS_MONTH.getTime());

    const resolutions = (await evidenceRowsFor(subscriptionId))
      .filter(row => row.action === 'billing_subscription_refund_evidence_resolved');

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]!.metadata).toEqual({
      evidenceVersion: 2,
      seq: 2,
      invoiceId: 'in_1',
      resolution: 'void',
      reason: 'refund_reversed:failed',
      eventId: 'evt_void_live',
      observedAmountRefunded: 0,
      observedAmount: 2400,
    });

    // A redelivered reversal finds nothing left to void.
    const replay = await applySubscriptionRefundVoid({
      stripeSubscriptionId: 'sub_s_pr1_void_live',
      invoiceId: 'in_1',
      reason: 'refund_reversed:failed',
      eventId: 'evt_void_live',
      observedAmountRefunded: 0,
      observedAmount: 2400,
      now: T0,
    });

    expect(replay).toEqual({ applied: true, voided: false, reapplied: false });
    expect((await evidenceRowsFor(subscriptionId))
      .filter(row => row.action === 'billing_subscription_refund_evidence_resolved')).toHaveLength(1);
  });

  it('a MALFORMED effective row is voided without a re-apply — there is no coverage to restore', async () => {
    const { applySubscriptionRefundVoid } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_void_malformed', { paidThrough: T0 });
    await seedRawEvidence({
      id: 'audit_void_malformed',
      salonId: 's_pr1_void_malformed',
      entityId: subscriptionId,
      action: 'billing_subscription_refund_applied',
      metadata: { invoiceId: 'in_bad' },
    });

    const outcome = await applySubscriptionRefundVoid({
      stripeSubscriptionId: 'sub_s_pr1_void_malformed',
      invoiceId: 'in_bad',
      reason: 'refund_reversed:reconcile',
      observedAmountRefunded: 100,
      observedAmount: 2400,
      actor: { actorType: 'system', actorId: 'billing-reconcile' },
      now: T0,
    });

    expect(outcome).toEqual({ applied: true, voided: true, reapplied: false });
    // paid_through is NOT guessed at; the operator `set` path is the way back.
    expect((await subscriptionRow('sub_s_pr1_void_malformed')).paidThrough.getTime()).toBe(T0.getTime());

    // The evidence is no longer incomplete, so grants stop failing closed.
    const { readSubscriptionRefunds } = await import('./subscriptionRefunds');
    const evidence = await db.transaction(tx =>
      readSubscriptionRefunds(tx, { id: subscriptionId, salonId: 's_pr1_void_malformed' }));

    expect(evidence.incomplete).toBe(false);
    expect(evidence.appliedInvoiceIds.size).toBe(0);
  });

  it('RT-19: after a void, a genuinely new FULL refund writes a fresh applied row that supersedes it', async () => {
    const { applySubscriptionFullRefund, applySubscriptionRefundVoid } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_rt19', { paidThrough: T0_PLUS_MONTH });
    await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_rt19',
      refundIds: ['re_1'],
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: T0_PLUS_MONTH,
      eventCreated: T0,
      eventId: 'evt_rt19_refund_1',
    });
    await applySubscriptionRefundVoid({
      stripeSubscriptionId: 'sub_s_pr1_rt19',
      invoiceId: 'in_1',
      reason: 'refund_reversed:failed',
      observedAmountRefunded: 0,
      observedAmount: 2400,
      now: T0,
    });

    // The charge is fully refunded AGAIN (a second, successful refund).
    const reRefund = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_rt19',
      refundIds: ['re_2'],
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: T0_PLUS_MONTH,
      eventCreated: T0,
      eventId: 'evt_rt19_refund_2',
      observedAmountRefunded: 2400,
      observedAmount: 2400,
    });

    expect(reRefund).toEqual({ applied: true, lowered: true });
    expect((await subscriptionRow('sub_s_pr1_rt19')).paidThrough.getTime()).toBe(T0.getTime());

    const { readSubscriptionRefunds } = await import('./subscriptionRefunds');
    const evidence = await db.transaction(tx =>
      readSubscriptionRefunds(tx, { id: subscriptionId, salonId: 's_pr1_rt19' }));

    // The fresh applied row carries the highest seq, so the invoice is
    // refunded again — the void is superseded, not erased.
    expect(evidence.refunds).toEqual([{ invoiceId: 'in_1', start: T0, end: T0_PLUS_MONTH }]);
    expect(evidence.rows).toBe(3);
    expect(evidence.nextSeq).toBe(4);
  });
});

describe('R-2 — operator evidence resolution', () => {
  it('plan reports the EFFECTIVE evidence and refuses a cross-tenant subscription id', async () => {
    const { planSubscriptionRefundEvidence, applySubscriptionFullRefund } = await projection();
    await seedSubscription('s_pr1_plan');
    await seedSalon('s_pr1_plan_other');
    await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_plan',
      refundIds: ['re_1'],
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: T0_PLUS_MONTH,
      eventCreated: T0,
      eventId: 'evt_plan_refund',
    });

    const plan = await planSubscriptionRefundEvidence(db, {
      salonId: 's_pr1_plan',
      stripeSubscriptionId: 'sub_s_pr1_plan',
    });

    expect(plan).toMatchObject({
      subscriptionRowId: 'bsub_s_pr1_plan',
      evidence: {
        incomplete: false,
        appliedInvoiceIds: ['in_1'],
        rows: 1,
        nextSeq: 2,
      },
    });
    expect(plan!.evidence.refunds).toEqual([{ invoiceId: 'in_1', start: T0, end: T0_PLUS_MONTH }]);

    // Another salon may never read this subscription by guessing its id.
    expect(await planSubscriptionRefundEvidence(db, {
      salonId: 's_pr1_plan_other',
      stripeSubscriptionId: 'sub_s_pr1_plan',
    })).toBeNull();
  });

  it('a cross-tenant or unknown subscription is SUBSCRIPTION_NOT_FOUND, never a write', async () => {
    const { applySubscriptionRefundEvidenceResolution } = await projection();
    await seedSubscription('s_pr1_res_tenant');
    await seedSalon('s_pr1_res_intruder');

    expect(await applySubscriptionRefundEvidenceResolution({
      salonId: 's_pr1_res_intruder',
      stripeSubscriptionId: 'sub_s_pr1_res_tenant',
      invoiceId: 'in_1',
      resolution: 'void',
      reason: 'not mine',
      actor: { actorType: 'super_admin', actorId: 'sa_1' },
    })).toEqual({ applied: false, anomaly: 'SUBSCRIPTION_NOT_FOUND' });

    expect(await evidenceRowsFor('bsub_s_pr1_res_tenant')).toHaveLength(0);
  });

  it('`set` repairs malformed legacy evidence, lowers paid_through, and refuses unusable bounds', async () => {
    const { applySubscriptionRefundEvidenceResolution } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_res_set', { paidThrough: T0_PLUS_MONTH });
    await seedRawEvidence({
      id: 'audit_res_set_legacy',
      salonId: 's_pr1_res_set',
      entityId: subscriptionId,
      action: 'billing_subscription_refund_applied',
      metadata: { invoiceId: 'in_1' },
    });

    expect(await applySubscriptionRefundEvidenceResolution({
      salonId: 's_pr1_res_set',
      stripeSubscriptionId: 'sub_s_pr1_res_set',
      invoiceId: 'in_1',
      resolution: 'set',
      periodStart: T0_PLUS_MONTH,
      periodEnd: T0,
      reason: 'inverted bounds',
      actor: { actorType: 'super_admin', actorId: 'sa_1' },
    })).toEqual({ applied: false, anomaly: 'INVALID_RESOLUTION_BOUNDS' });

    expect(await evidenceRowsFor(subscriptionId)).toHaveLength(1); // only the seeded legacy row

    const applied = await applySubscriptionRefundEvidenceResolution({
      salonId: 's_pr1_res_set',
      stripeSubscriptionId: 'sub_s_pr1_res_set',
      invoiceId: 'in_1',
      resolution: 'set',
      periodStart: T0,
      periodEnd: T0_PLUS_MONTH,
      reason: 'coverage read off the Stripe invoice by hand',
      actor: { actorType: 'super_admin', actorId: 'sa_1' },
    });

    expect(applied).toEqual({ applied: true, seq: 1, lowered: true });
    expect((await subscriptionRow('sub_s_pr1_res_set')).paidThrough.getTime()).toBe(T0.getTime());

    const { readSubscriptionRefunds } = await import('./subscriptionRefunds');
    const evidence = await db.transaction(tx =>
      readSubscriptionRefunds(tx, { id: subscriptionId, salonId: 's_pr1_res_set' }));

    expect(evidence.incomplete).toBe(false);
    expect(evidence.refunds).toEqual([{ invoiceId: 'in_1', start: T0, end: T0_PLUS_MONTH }]);
  });

  it('`void` from the operator restores entitlement the same way the webhook writer does', async () => {
    const { applySubscriptionFullRefund, applySubscriptionRefundEvidenceResolution } = await projection();
    const subscriptionId = await seedSubscription('s_pr1_res_void', { paidThrough: T0_PLUS_MONTH });
    await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_pr1_res_void',
      refundIds: ['re_1'],
      invoiceId: 'in_1',
      refundedPeriodStart: T0,
      refundedPeriodEnd: T0_PLUS_MONTH,
      eventCreated: T0,
      eventId: 'evt_res_void_refund',
    });

    const outcome = await applySubscriptionRefundEvidenceResolution({
      salonId: 's_pr1_res_void',
      stripeSubscriptionId: 'sub_s_pr1_res_void',
      invoiceId: 'in_1',
      resolution: 'void',
      reason: 'refund never settled; Stripe reversed it',
      actor: { actorType: 'super_admin', actorId: 'sa_1' },
      now: T0,
    });

    expect(outcome).toEqual({ applied: true, reapplied: true });
    expect((await subscriptionRow('sub_s_pr1_res_void')).paidThrough.getTime()).toBe(T0_PLUS_MONTH.getTime());

    const resolutions = (await evidenceRowsFor(subscriptionId))
      .filter(row => row.action === 'billing_subscription_refund_evidence_resolved');

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ actorType: 'super_admin', actorId: 'sa_1' });
    expect(resolutions[0]!.metadata).toEqual({
      evidenceVersion: 2,
      seq: 2,
      invoiceId: 'in_1',
      resolution: 'void',
      reason: 'refund never settled; Stripe reversed it',
    });
  });
});
