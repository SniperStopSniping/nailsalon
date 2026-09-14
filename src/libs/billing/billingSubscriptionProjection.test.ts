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

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  priceMapHolder.resolvedOfferKey = null;
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
      refundedPeriodStart: T0,
      eventCreated: T0,
      eventId: 'evt_refund_replay_1_retry',
    });
    const secondEvent = await applySubscriptionFullRefund({
      stripeSubscriptionId: 'sub_s_refund_replay',
      refundId: 're_replay_2',
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
