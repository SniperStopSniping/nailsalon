/**
 * Legacy route new-track isolation — LG-1..LG-5 (Rev 2.3 §5, D19c).
 *
 * Two things are under test, and the second matters as much as the first:
 *
 *  1. A NEW-TRACK object (Guard A's `metadata.purpose`, or Guard B's existing
 *     `billing_subscription` row) is never projected onto a salon row — no
 *     `billingMode` flip, no ids, no email, no audit row, no `syncSubscription`
 *     — and the event is still acknowledged 200 so Stripe does not retry.
 *
 *  2. A GENUINE LEGACY object is processed byte-identically to Rev 2.2. That is
 *     why the update PAYLOADS are captured and compared exactly rather than
 *     spot-checked: the guards must be provably invisible to today's behaviour.
 *
 * The database is real (PGlite + the shipped migrations) so "zero writes" is a
 * fact about rows, not about a mock. `db.update()` is wrapped to record the
 * `.set()` payload and then delegate, so the snapshot assertions see exactly
 * what the route asked for. The audit loggers are module-mocked, so zero calls
 * is zero audit rows. `constructEvent` is REAL — stubbing it would make every
 * 200 in this file meaningless (the convention of `route.test.ts`).
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const LEGACY_SECRET = 'whsec_legacy_guard_test';

const holder = vi.hoisted(() => ({
  db: null as unknown,
  updates: [] as Record<string, unknown>[],
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const { logBillingModeChange, logSubscriptionStatusChange } = vi.hoisted(() => ({
  logBillingModeChange: vi.fn(async () => {}),
  logSubscriptionStatusChange: vi.fn(async () => {}),
}));

vi.mock('@/libs/auditLog', () => ({
  logBillingModeChange,
  logSubscriptionStatusChange,
}));

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({
  captureException,
  captureMessage: vi.fn(),
}));

vi.mock('@/libs/Env', () => ({
  Env: {
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: LEGACY_SECRET,
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect_legacy_guard_test',
  },
}));

vi.mock('@/libs/stripe', async () => {
  const { default: RealStripe } = await vi.importActual<typeof import('stripe')>('stripe');
  const unpinned = new RealStripe('sk_test_placeholder');
  const actualModule = await vi.importActual<typeof import('@/libs/stripe')>('@/libs/stripe');
  return {
    stripe: {
      subscriptions: { retrieve: vi.fn() },
      // REAL HMAC — never stub.
      webhooks: unpinned.webhooks,
    },
    EXPECTED_STRIPE_API_VERSION: actualModule.EXPECTED_STRIPE_API_VERSION,
  };
});

type Drizzle = ReturnType<typeof drizzle<typeof schema>>;

let realDb: Drizzle;

/**
 * Records every `.set()` payload and delegates to the real builder, so the
 * legacy snapshots compare what the route ASKED for, not what survived a merge.
 */
function recordingDb(database: Drizzle): Drizzle {
  return new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (property !== 'update') {
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      }
      return (table: Parameters<Drizzle['update']>[0]) => {
        const builder = target.update(table);
        return {
          set: (values: Record<string, unknown>) => {
            holder.updates.push(values);
            return builder.set(values);
          },
        };
      };
    },
  }) as Drizzle;
}

const { POST } = await import('./route');
const { stripe } = await import('@/libs/stripe');

const retrieve = vi.mocked(stripe.subscriptions.retrieve);

function signedRequest(payload: object, secret = LEGACY_SECRET): NextRequest {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body,
    headers: { 'stripe-signature': header, 'content-type': 'application/json' },
  }) as unknown as NextRequest;
}

function stripeEvent(type: string, object: Record<string, unknown>) {
  return {
    id: `evt_${type.replace(/\W/g, '_')}_${Math.random().toString(36).slice(2, 8)}`,
    object: 'event',
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
}

function checkoutSession(options: {
  salonId: string;
  purpose?: string;
  sessionId?: string;
}) {
  return {
    id: options.sessionId ?? 'cs_test_legacy_guard',
    object: 'checkout.session',
    customer: 'cus_guard',
    subscription: 'sub_guard',
    customer_email: 'owner@example.com',
    metadata: {
      salonId: options.salonId,
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
    },
  };
}

/** The object `stripe.subscriptions.retrieve` resolves to. */
function retrievedSubscription(options: {
  id: string;
  salonId?: string;
  purpose?: string;
  status?: string;
}) {
  return {
    id: options.id,
    object: 'subscription',
    customer: 'cus_guard',
    status: options.status ?? 'active',
    current_period_end: 1893456000,
    items: { data: [{ price: { id: 'price_legacy' } }] },
    metadata: {
      ...(options.salonId === undefined ? {} : { salonId: options.salonId }),
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
    },
  } as unknown as Stripe.Response<Stripe.Subscription>;
}

async function seedSalon(id: string, overrides: Partial<typeof schema.salonSchema.$inferInsert> = {}) {
  await realDb.insert(schema.salonSchema).values({
    id,
    name: `Salon ${id}`,
    slug: `salon-${id}`,
    billingMode: 'NONE',
    plan: 'single_salon',
    features: { marketing: { smsReminders: true } },
    ...overrides,
  });
}

async function salonRow(id: string) {
  const [row] = await realDb
    .select()
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, id))
    .limit(1);
  return row;
}

async function seedBillingSubscription(salonId: string, stripeSubscriptionId: string) {
  await realDb.insert(schema.billingSubscriptionSchema).values({
    id: `bsub_${stripeSubscriptionId}`,
    salonId,
    stripeSubscriptionId,
    stripeCustomerId: 'cus_guard',
    planDefinitionKey: 'starter_2026_08',
    billingOfferKey: 'starter_2026_08_monthly',
    billingCadence: 'monthly',
    status: 'active',
    paidThrough: new Date('2026-10-16T00:00:00Z'),
    creditCycleAnchor: new Date('2026-09-16T00:00:00Z'),
  });
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  const client = new PGlite();
  realDb = drizzle(client, { schema });
  await migrate(realDb, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = recordingDb(realDb);
});

beforeEach(() => {
  holder.updates = [];
  vi.clearAllMocks();
  // `failOnConsole` is on (`vitest-setup.ts`), so the route's operational
  // logging has to be captured rather than allowed to reach the console.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// LG-1 — checkout.session.completed
// =============================================================================

describe('LG-1 — Guard A on checkout.session.completed', () => {
  it('ignores a plan_subscription session that carries a real salonId', async () => {
    await seedSalon('lg1_plan');
    const before = await salonRow('lg1_plan');

    const response = await POST(signedRequest(stripeEvent(
      'checkout.session.completed',
      checkoutSession({ salonId: 'lg1_plan', purpose: 'plan_subscription', sessionId: 'cs_plan_1' }),
    )));

    expect(response.status).toBe(200);
    expect(holder.updates).toEqual([]);
    expect(await salonRow('lg1_plan')).toEqual(before);
    expect(logBillingModeChange).not.toHaveBeenCalled();
    expect(logSubscriptionStatusChange).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    // No PII: the session id and the purpose, nothing else.
    expect(warn).toHaveBeenCalledWith(
      '[Stripe Webhook] checkout.session.completed: new-track session ignored',
      { sessionId: 'cs_plan_1', purpose: 'plan_subscription' },
    );
  });

  it('ignores an sms_topup session that carries a real salonId', async () => {
    await seedSalon('lg1_topup');
    const before = await salonRow('lg1_topup');

    const response = await POST(signedRequest(stripeEvent(
      'checkout.session.completed',
      checkoutSession({ salonId: 'lg1_topup', purpose: 'sms_topup', sessionId: 'cs_topup_1' }),
    )));

    expect(response.status).toBe(200);
    expect(holder.updates).toEqual([]);
    expect(await salonRow('lg1_topup')).toEqual(before);
    expect(logBillingModeChange).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[Stripe Webhook] checkout.session.completed: new-track session ignored',
      { sessionId: 'cs_topup_1', purpose: 'sms_topup' },
    );
  });

  it('processes an unmarked legacy session with a byte-identical update payload', async () => {
    await seedSalon('lg1_legacy');
    retrieve.mockResolvedValue(retrievedSubscription({ id: 'sub_guard', salonId: 'lg1_legacy' }));

    const response = await POST(signedRequest(stripeEvent(
      'checkout.session.completed',
      checkoutSession({ salonId: 'lg1_legacy' }),
    )));

    expect(response.status).toBe(200);

    // The checkout payload is the first of the two (the second is the sync).
    const [checkoutPayload] = holder.updates;
    const { updatedAt, ...fields } = checkoutPayload ?? {};

    expect(fields).toEqual({
      billingMode: 'STRIPE',
      stripeCustomerId: 'cus_guard',
      stripeSubscriptionId: 'sub_guard',
      stripeCustomerEmail: 'owner@example.com',
    });
    expect(updatedAt).toBeInstanceOf(Date);
    expect(logBillingModeChange).toHaveBeenCalledTimes(1);
    expect(logBillingModeChange).toHaveBeenCalledWith('lg1_legacy', 'NONE', 'STRIPE', 'webhook');

    // INV-C1: neither side ever writes plan or features.
    const after = await salonRow('lg1_legacy');

    expect(after?.plan).toBe('single_salon');
    expect(after?.features).toEqual({ marketing: { smsReminders: true } });
    expect(after?.billingMode).toBe('STRIPE');
  });
});

// =============================================================================
// LG-2 — the subscription/invoice lifecycle funnel
// =============================================================================

describe('LG-2 — Guard A in syncSubscription', () => {
  it('ignores a marked subscription reached through customer.subscription.updated', async () => {
    await seedSalon('lg2_sub');
    const before = await salonRow('lg2_sub');
    retrieve.mockResolvedValue(retrievedSubscription({
      id: 'sub_lg2_marked',
      salonId: 'lg2_sub',
      purpose: 'plan_subscription',
    }));

    const response = await POST(signedRequest(stripeEvent('customer.subscription.updated', {
      id: 'sub_lg2_marked',
      object: 'subscription',
    })));

    expect(response.status).toBe(200);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(holder.updates).toEqual([]);
    expect(await salonRow('lg2_sub')).toEqual(before);
    expect(logSubscriptionStatusChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[Stripe Webhook] syncSubscription: new-track subscription ignored',
      { subscriptionId: 'sub_lg2_marked', purpose: 'plan_subscription' },
    );
  });

  it('ignores a marked subscription reached through invoice.payment_succeeded', async () => {
    await seedSalon('lg2_invoice');
    const before = await salonRow('lg2_invoice');
    retrieve.mockResolvedValue(retrievedSubscription({
      id: 'sub_lg2_invoice',
      salonId: 'lg2_invoice',
      purpose: 'plan_subscription',
    }));

    const response = await POST(signedRequest(stripeEvent('invoice.payment_succeeded', {
      id: 'in_lg2',
      object: 'invoice',
      subscription: 'sub_lg2_invoice',
    })));

    expect(response.status).toBe(200);
    // Exactly one retrieve: the guard reads the metadata already on that object
    // rather than making a second call.
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(holder.updates).toEqual([]);
    expect(await salonRow('lg2_invoice')).toEqual(before);
    expect(logSubscriptionStatusChange).not.toHaveBeenCalled();
  });

  it('syncs an unmarked subscription with a byte-identical update set', async () => {
    await seedSalon('lg2_legacy', { stripeSubscriptionStatus: 'past_due' });
    retrieve.mockResolvedValue(retrievedSubscription({
      id: 'sub_lg2_legacy',
      salonId: 'lg2_legacy',
      status: 'active',
    }));

    const response = await POST(signedRequest(stripeEvent('customer.subscription.updated', {
      id: 'sub_lg2_legacy',
      object: 'subscription',
    })));

    expect(response.status).toBe(200);
    expect(holder.updates).toHaveLength(1);

    const { updatedAt, ...fields } = holder.updates[0] ?? {};

    expect(fields).toEqual({
      stripeCustomerId: 'cus_guard',
      stripeSubscriptionId: 'sub_lg2_legacy',
      stripeSubscriptionStatus: 'active',
      stripePriceId: 'price_legacy',
      stripeCurrentPeriodEnd: 1893456000,
    });
    expect(updatedAt).toBeInstanceOf(Date);
    expect(logSubscriptionStatusChange).toHaveBeenCalledTimes(1);
    expect(logSubscriptionStatusChange).toHaveBeenCalledWith(
      'lg2_legacy',
      'past_due',
      'active',
      'sub_lg2_legacy',
    );

    const after = await salonRow('lg2_legacy');

    expect(after?.plan).toBe('single_salon');
    expect(after?.features).toEqual({ marketing: { smsReminders: true } });
  });
});

// =============================================================================
// LG-3 — Guard B, the local-ownership backstop
// =============================================================================

describe('LG-3 — Guard B', () => {
  it('ignores an unmarked subscription that this track already owns a row for', async () => {
    await seedSalon('lg3_owned');
    await seedBillingSubscription('lg3_owned', 'sub_lg3_owned');
    const before = await salonRow('lg3_owned');
    // The marker was stripped or dashboard-edited away: only the local row is left.
    retrieve.mockResolvedValue(retrievedSubscription({ id: 'sub_lg3_owned', salonId: 'lg3_owned' }));

    const response = await POST(signedRequest(stripeEvent('customer.subscription.updated', {
      id: 'sub_lg3_owned',
      object: 'subscription',
    })));

    expect(response.status).toBe(200);
    expect(holder.updates).toEqual([]);
    expect(await salonRow('lg3_owned')).toEqual(before);
    expect(logSubscriptionStatusChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[Stripe Webhook] syncSubscription: billing-track subscription ignored',
      { subscriptionId: 'sub_lg3_owned', reason: 'billing_subscription_row_exists' },
    );
  });

  it('is a no-op for a genuine legacy subscription — no marker and no row means legacy sync runs', async () => {
    await seedSalon('lg3_legacy');
    // A billing_subscription row exists for a DIFFERENT subscription id, so the
    // indexed read must not match it.
    await seedBillingSubscription('lg3_legacy', 'sub_lg3_other');
    retrieve.mockResolvedValue(retrievedSubscription({ id: 'sub_lg3_legacy', salonId: 'lg3_legacy' }));

    const response = await POST(signedRequest(stripeEvent('customer.subscription.updated', {
      id: 'sub_lg3_legacy',
      object: 'subscription',
    })));

    expect(response.status).toBe(200);
    expect(holder.updates).toHaveLength(1);
    expect(holder.updates[0]).toMatchObject({ stripeSubscriptionId: 'sub_lg3_legacy' });
    expect((await salonRow('lg3_legacy'))?.stripeSubscriptionId).toBe('sub_lg3_legacy');
  });
});

// =============================================================================
// LG-5 + preserved guarantees
// =============================================================================

describe('LG-5 — acknowledgement and failure shapes are unchanged', () => {
  it('a guard-skipped event answers 200 on every delivery, so Stripe never retries it', async () => {
    await seedSalon('lg5_skip');
    const before = await salonRow('lg5_skip');
    const event = stripeEvent(
      'checkout.session.completed',
      checkoutSession({ salonId: 'lg5_skip', purpose: 'plan_subscription', sessionId: 'cs_skip_1' }),
    );

    const first = await POST(signedRequest(event));
    const redelivery = await POST(signedRequest(event));

    // No event-id table: the skip is a pure no-op on EVERY delivery, and the
    // second delivery is not "already processed" — it is skipped identically.
    expect(first.status).toBe(200);
    expect(redelivery.status).toBe(200);
    expect(holder.updates).toEqual([]);
    expect(await salonRow('lg5_skip')).toEqual(before);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('a thrown error in the legacy path still answers 500 with the same Sentry shape', async () => {
    await seedSalon('lg5_throw');
    retrieve.mockRejectedValue(new Error('stripe is down'));

    const event = stripeEvent('customer.subscription.updated', {
      id: 'sub_lg5_throw',
      object: 'subscription',
    });
    const response = await POST(signedRequest(event));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Webhook handler error: stripe is down');
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { webhook: 'stripe', event_type: 'customer.subscription.updated' },
      extra: { event_id: event.id },
    });
    expect(error).toHaveBeenCalledWith(
      '[Stripe Webhook] Error processing customer.subscription.updated: stripe is down',
    );
  });

  it('signature verification is unchanged: a wrong secret is rejected 400 before any guard', async () => {
    const response = await POST(signedRequest(
      stripeEvent('checkout.session.completed', checkoutSession({ salonId: 'lg5_skip' })),
      'whsec_connect_legacy_guard_test',
    ));

    expect(response.status).toBe(400);
    expect(holder.updates).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Signature verification failed'),
    );
  });

  it('the route gains no event-id table and no shared state with the billing endpoint', async () => {
    const source = await import('node:fs').then(fs =>
      fs.readFileSync('src/app/api/webhooks/stripe/route.ts', 'utf-8'));

    // §8.2 independence: the only new table this route may name is the one
    // Guard B reads, and it reads it — never writes it.
    expect(source).not.toContain('billing_stripe_event');
    expect(source).not.toContain('billingStripeEvent');
    expect(source).not.toContain('stripe_webhook_event');
    expect(source).not.toContain('insert(billingSubscriptionSchema');
    expect(source).toContain('billingSubscriptionSchema');
    // The signature secret is still the legacy one only.
    expect(source).toContain('STRIPE_WEBHOOK_SECRET');
    expect(source).not.toContain('STRIPE_BILLING_WEBHOOK_SECRET');
  });
});
