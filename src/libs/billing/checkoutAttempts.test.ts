/**
 * Checkout-attempt serialization — §8.5 and OP-2 / handoff §6.2 (Y2).
 *
 * The invariant under test: an ACTIVE attempt may be reused ONLY for the offer
 * (and, for subscriptions, the promotion) it was created for. Reuse hands the
 * caller the attempt's existing Checkout Session, so reusing across offers
 * would show a returning customer the price and disclosure of the offer they
 * abandoned, and would let the subscription route reserve a capped promotion
 * claim against a session that carries no discount.
 *
 * Every pre-existing refusal string and every pre-existing transition (the TTL
 * expiry sweep, ACTIVE_SUBSCRIPTION_EXISTS, CHECKOUT_PENDING_RECONCILIATION,
 * the top-up grant/expired resolution, and the targetless
 * ON CONFLICT DO NOTHING that must never abort the caller's transaction) is
 * pinned here too, because the money paths above depend on them.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

const attempts = () => import('./checkoutAttempts');

const OFFER_A = 'starter_2026_08_monthly';
const OFFER_B = 'pro_2026_08_monthly';
const PROMOTION = 'founding_annual_2026';
const TOPUP_A = 'topup_100_paid_2026_08';
const TOPUP_B = 'topup_500_paid_2026_08';

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: `Salon ${id}`, slug: `salon-${id}` });
}

async function activeAttemptRows(salonId: string) {
  return db
    .select()
    .from(schema.billingCheckoutAttemptSchema)
    .where(eq(schema.billingCheckoutAttemptSchema.salonId, salonId));
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

describe('OP-2/Y2 — an ACTIVE attempt is reusable only for the SAME offer', () => {
  it('reuses for the identical offer and refuses a DIFFERENT billing offer with CHECKOUT_IN_PROGRESS', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_oa_offer');

    const created = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_oa_offer', purpose: 'plan_subscription', billingOfferKey: OFFER_A }));

    expect(created).toMatchObject({ ok: true, reused: false });

    const sameOffer = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_oa_offer', purpose: 'plan_subscription', billingOfferKey: OFFER_A }));

    expect(sameOffer).toMatchObject({ ok: true, reused: true });
    expect((sameOffer as { attemptId: string }).attemptId).toBe((created as { attemptId: string }).attemptId);

    // The defect: this used to hand back OFFER_A's session (and its price and
    // disclosure) for an OFFER_B checkout.
    const otherOffer = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_oa_offer', purpose: 'plan_subscription', billingOfferKey: OFFER_B }));

    expect(otherOffer).toEqual({ ok: false, reason: 'CHECKOUT_IN_PROGRESS' });

    // A refusal writes nothing: the OFFER_A attempt is still the only row.
    const rows = await activeAttemptRows('s_oa_offer');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ billingOfferKey: OFFER_A, status: 'creating' });
  });

  it('refuses when a promotion is ADDED on the retry (null → key)', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_oa_promo_added');

    await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_oa_promo_added', purpose: 'plan_subscription', billingOfferKey: OFFER_A }));

    // Same offer, but the retry carries a promotion. Reuse would burn a capped
    // claim against a session created without the discount.
    const withPromotion = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, {
        salonId: 's_oa_promo_added',
        purpose: 'plan_subscription',
        billingOfferKey: OFFER_A,
        promotionKey: PROMOTION,
      }));

    expect(withPromotion).toEqual({ ok: false, reason: 'CHECKOUT_IN_PROGRESS' });
  });

  it('refuses when a promotion is REMOVED on the retry (key → null), and reuses when it is unchanged', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_oa_promo_removed');

    const created = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, {
        salonId: 's_oa_promo_removed',
        purpose: 'plan_subscription',
        billingOfferKey: OFFER_A,
        promotionKey: PROMOTION,
      }));

    const withoutPromotion = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, {
        salonId: 's_oa_promo_removed',
        purpose: 'plan_subscription',
        billingOfferKey: OFFER_A,
        promotionKey: null,
      }));

    expect(withoutPromotion).toEqual({ ok: false, reason: 'CHECKOUT_IN_PROGRESS' });

    // An omitted key is the column's null — and the SAME promotion still reuses.
    const omitted = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_oa_promo_removed', purpose: 'plan_subscription', billingOfferKey: OFFER_A }));

    expect(omitted).toEqual({ ok: false, reason: 'CHECKOUT_IN_PROGRESS' });

    const samePromotion = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, {
        salonId: 's_oa_promo_removed',
        purpose: 'plan_subscription',
        billingOfferKey: OFFER_A,
        promotionKey: PROMOTION,
      }));

    expect(samePromotion).toMatchObject({ ok: true, reused: true });
    expect((samePromotion as { attemptId: string }).attemptId).toBe((created as { attemptId: string }).attemptId);
  });

  it('keeps the top-up comparison unchanged: a different topupOfferKey is CHECKOUT_IN_PROGRESS', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_oa_topup');

    const created = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_oa_topup', purpose: 'sms_topup', topupOfferKey: TOPUP_A }));

    expect(created).toMatchObject({ ok: true, reused: false });

    const sameOffer = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_oa_topup', purpose: 'sms_topup', topupOfferKey: TOPUP_A }));

    expect(sameOffer).toMatchObject({ ok: true, reused: true });

    const otherOffer = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_oa_topup', purpose: 'sms_topup', topupOfferKey: TOPUP_B }));

    expect(otherOffer).toEqual({ ok: false, reason: 'CHECKOUT_IN_PROGRESS' });
  });

  it('the refusal is transient, not a lock-out: the TTL sweep still releases the slot for a different offer', async () => {
    const { beginCheckoutAttempt, CHECKOUT_ATTEMPT_TTL_MS } = await attempts();
    await seedSalon('s_oa_ttl');
    const start = new Date('2026-09-16T10:00:00.000Z');

    const created = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, {
        salonId: 's_oa_ttl',
        purpose: 'plan_subscription',
        billingOfferKey: OFFER_A,
        now: start,
      }));

    expect(created).toMatchObject({ ok: true, reused: false });

    const afterTtl = new Date(start.getTime() + CHECKOUT_ATTEMPT_TTL_MS + 1000);
    const fresh = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, {
        salonId: 's_oa_ttl',
        purpose: 'plan_subscription',
        billingOfferKey: OFFER_B,
        now: afterTtl,
      }));

    expect(fresh).toMatchObject({ ok: true, reused: false });
    expect((fresh as { attemptId: string }).attemptId).not.toBe((created as { attemptId: string }).attemptId);

    const rows = await activeAttemptRows('s_oa_ttl');
    const statuses = rows.map(row => `${row.billingOfferKey}:${row.status}`).sort();

    expect(statuses).toEqual([`${OFFER_B}:creating`, `${OFFER_A}:expired`]);
  });
});

/**
 * A transaction double that reproduces the ONE ordering a single-connection
 * PGlite test cannot produce for real: a concurrent request commits its own
 * active attempt AFTER our reuse SELECT has already answered "nothing active"
 * and BEFORE our INSERT runs. Only that SELECT is replaced (it answers empty
 * and lets the winner land); the TTL sweep, the INSERT — including its genuine
 * partial-unique violation — and the fallback re-SELECT are all the real
 * statements against the real database.
 *
 * True cross-connection concurrency is proven separately in the Postgres
 * concurrency suite; this pins the branch's logic and, because the INSERT is
 * real, that the targetless ON CONFLICT DO NOTHING swallows the violation
 * instead of aborting (25P02) the caller's transaction.
 */
function racingTransaction(
  tx: BillingDbTransaction,
  commitConcurrentWinner: () => Promise<void>,
): BillingDbTransaction {
  const realSelect = tx.select.bind(tx) as unknown as (...args: unknown[]) => unknown;
  const realUpdate = tx.update.bind(tx) as unknown as (...args: unknown[]) => unknown;
  const realInsert = tx.insert.bind(tx) as unknown as (...args: unknown[]) => unknown;
  // The TTL sweep is the UPDATE that sits between the live-subscription SELECT
  // and the reuse SELECT, so it marks which SELECT to answer empty.
  let ttlSweepRan = false;
  let raceSimulated = false;

  type EmptySelect = { from: () => EmptySelect; where: () => EmptySelect; limit: () => Promise<never[]> };
  const emptySelect = (): EmptySelect => {
    const builder: EmptySelect = {
      from: () => builder,
      where: () => builder,
      limit: async () => {
        await commitConcurrentWinner();
        return [];
      },
    };
    return builder;
  };

  return {
    select: (...args: unknown[]) => {
      if (ttlSweepRan && !raceSimulated) {
        raceSimulated = true;
        return emptySelect();
      }
      return realSelect(...args);
    },
    update: (...args: unknown[]) => {
      ttlSweepRan = true;
      return realUpdate(...args);
    },
    insert: (...args: unknown[]) => realInsert(...args),
  } as unknown as BillingDbTransaction;
}

/**
 * The narrower double: the INSERT reports "nothing inserted" (a conflict) while
 * the database holds no active row that could explain it. Everything else is
 * the real transaction.
 */
function swallowedInsertTransaction(tx: BillingDbTransaction): BillingDbTransaction {
  const realSelect = tx.select.bind(tx) as unknown as (...args: unknown[]) => unknown;
  const realUpdate = tx.update.bind(tx) as unknown as (...args: unknown[]) => unknown;

  return {
    select: (...args: unknown[]) => realSelect(...args),
    update: (...args: unknown[]) => realUpdate(...args),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => [] }),
      }),
    }),
  } as unknown as BillingDbTransaction;
}

describe('OP-2/Y2 — the insert-race fallback applies the same per-purpose comparison', () => {
  async function insertWinner(
    tx: BillingDbTransaction,
    input: { id: string; salonId: string; billingOfferKey: string; promotionKey?: string | null },
  ) {
    await tx.insert(schema.billingCheckoutAttemptSchema).values({
      id: input.id,
      salonId: input.salonId,
      purpose: 'plan_subscription',
      billingOfferKey: input.billingOfferKey,
      promotionKey: input.promotionKey ?? null,
      status: 'creating',
      stripeIdempotencyKey: `billing-attempt:${input.id}`,
      expiresAt: new Date('2026-09-16T12:00:00.000Z'),
    });
  }

  it('reuses the winner when its offer and promotion match, and leaves the caller transaction usable', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_race_match');

    const outcome = await db.transaction(async (tx) => {
      const result = await beginCheckoutAttempt(
        racingTransaction(tx, () => insertWinner(tx, {
          id: 'bca_race_match_winner',
          salonId: 's_race_match',
          billingOfferKey: OFFER_A,
        })),
        { salonId: 's_race_match', purpose: 'plan_subscription', billingOfferKey: OFFER_A },
      );
      // A unique violation must never poison the transaction (25P02): the very
      // next statement in the SAME transaction still has to run.
      const stillUsable = await tx.execute(sql`SELECT 1 AS ok`);
      return { result, stillUsable: Number((stillUsable.rows[0] as Record<string, unknown>).ok) };
    });

    expect(outcome.stillUsable).toBe(1);
    expect(outcome.result).toEqual({
      ok: true,
      attemptId: 'bca_race_match_winner',
      stripeIdempotencyKey: 'billing-attempt:bca_race_match_winner',
      reused: true,
    });

    // Exactly one attempt row survived: ours was never persisted.
    const rows = await activeAttemptRows('s_race_match');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('bca_race_match_winner');
  });

  it('refuses when the winner carries a different offer, instead of handing back its session', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_race_mismatch');

    const outcome = await db.transaction(async (tx) => {
      const result = await beginCheckoutAttempt(
        racingTransaction(tx, () => insertWinner(tx, {
          id: 'bca_race_mismatch_winner',
          salonId: 's_race_mismatch',
          billingOfferKey: OFFER_B,
        })),
        { salonId: 's_race_mismatch', purpose: 'plan_subscription', billingOfferKey: OFFER_A },
      );
      const stillUsable = await tx.execute(sql`SELECT 1 AS ok`);
      return { result, stillUsable: Number((stillUsable.rows[0] as Record<string, unknown>).ok) };
    });

    expect(outcome.stillUsable).toBe(1);
    expect(outcome.result).toEqual({ ok: false, reason: 'CHECKOUT_IN_PROGRESS' });
  });

  it('refuses when the winner carries a different promotion for the same offer', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_race_promo');

    const result = await db.transaction(async tx =>
      beginCheckoutAttempt(
        racingTransaction(tx, () => insertWinner(tx, {
          id: 'bca_race_promo_winner',
          salonId: 's_race_promo',
          billingOfferKey: OFFER_A,
          promotionKey: PROMOTION,
        })),
        { salonId: 's_race_promo', purpose: 'plan_subscription', billingOfferKey: OFFER_A },
      ));

    expect(result).toEqual({ ok: false, reason: 'CHECKOUT_IN_PROGRESS' });
  });

  it('still throws CHECKOUT_ATTEMPT_CONFLICT_UNRESOLVED when the conflict cannot be explained', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_race_unresolved');

    // An INSERT that reports a conflict while no ACTIVE row exists to explain
    // it is a state the module refuses to guess about — unchanged behaviour,
    // pinned here because the fallback around it was restructured.
    await expect(db.transaction(async tx =>
      beginCheckoutAttempt(
        swallowedInsertTransaction(tx),
        { salonId: 's_race_unresolved', purpose: 'plan_subscription', billingOfferKey: OFFER_A },
      ))).rejects.toThrow('CHECKOUT_ATTEMPT_CONFLICT_UNRESOLVED');

    expect(await activeAttemptRows('s_race_unresolved')).toHaveLength(0);
  });
});

describe('§8.5 refusals and transitions that must not change', () => {
  it('a LIVE subscription refuses with ACTIVE_SUBSCRIPTION_EXISTS before any attempt is written', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_live_sub');
    await db.insert(schema.billingSubscriptionSchema).values({
      id: 'bsub_live_sub',
      salonId: 's_live_sub',
      stripeSubscriptionId: 'sub_live_sub',
      stripeCustomerId: 'cus_live_sub',
      planDefinitionKey: 'pro_2026_08',
      billingOfferKey: OFFER_B,
      billingCadence: 'monthly',
      status: 'active',
      paidThrough: new Date('2026-10-01T00:00:00.000Z'),
      creditCycleAnchor: new Date('2026-09-01T00:00:00.000Z'),
    });

    const blocked = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_live_sub', purpose: 'plan_subscription', billingOfferKey: OFFER_A }));

    expect(blocked).toEqual({ ok: false, reason: 'ACTIVE_SUBSCRIPTION_EXISTS' });
    expect(await activeAttemptRows('s_live_sub')).toHaveLength(0);
  });

  it('more than one unresolved top-up attempt refuses with CHECKOUT_PENDING_RECONCILIATION', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_pending');
    for (const suffix of ['a', 'b']) {
      await db.insert(schema.billingCheckoutAttemptSchema).values({
        id: `bca_pending_${suffix}`,
        salonId: 's_pending',
        purpose: 'sms_topup',
        topupOfferKey: TOPUP_A,
        status: 'checkout_created',
        stripeIdempotencyKey: `billing-attempt:bca_pending_${suffix}`,
        stripeCheckoutSessionId: `cs_pending_${suffix}`,
        expiresAt: new Date('2026-09-16T12:00:00.000Z'),
      });
    }

    const pending = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_pending', purpose: 'sms_topup', topupOfferKey: TOPUP_A }));

    expect(pending).toEqual({ ok: false, reason: 'CHECKOUT_PENDING_RECONCILIATION' });
  });

  it('a top-up attempt whose purchase already expired is resolved and a fresh attempt is created', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_topup_resolved');
    await db.insert(schema.billingCheckoutAttemptSchema).values({
      id: 'bca_topup_resolved',
      salonId: 's_topup_resolved',
      purpose: 'sms_topup',
      topupOfferKey: TOPUP_A,
      status: 'checkout_created',
      stripeIdempotencyKey: 'billing-attempt:bca_topup_resolved',
      stripeCheckoutSessionId: 'cs_topup_resolved',
      expiresAt: new Date('2026-09-16T12:00:00.000Z'),
    });
    await db.insert(schema.smsTopupPurchaseSchema).values({
      id: 'stp_topup_resolved',
      salonId: 's_topup_resolved',
      topupOfferKey: TOPUP_A,
      credits: 100,
      amountCents: 1500,
      status: 'expired',
      stripeCheckoutSessionId: 'cs_topup_resolved',
    });

    // A DIFFERENT offer: the resolved attempt no longer blocks anything, so the
    // offer comparison is not even reached.
    const fresh = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_topup_resolved', purpose: 'sms_topup', topupOfferKey: TOPUP_B }));

    expect(fresh).toMatchObject({ ok: true, reused: false });

    const [resolved] = await db
      .select()
      .from(schema.billingCheckoutAttemptSchema)
      .where(eq(schema.billingCheckoutAttemptSchema.id, 'bca_topup_resolved'));

    expect(resolved!.status).toBe('expired');
  });
});
