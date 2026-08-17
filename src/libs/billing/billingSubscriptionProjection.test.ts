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
import { beforeAll, describe, expect, it, vi } from 'vitest';

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

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
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
