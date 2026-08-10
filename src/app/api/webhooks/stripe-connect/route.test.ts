/**
 * Connect webhook lifecycle (charter tests 16–21, plus 34(e1)).
 *
 * Signature verification uses the REAL `stripe.webhooks` implementation. Stubbing
 * `constructEvent` is the repo's existing anti-pattern and is forbidden here: a
 * stub would let every assertion below pass against a handler that never
 * authenticated anything.
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

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => sentry);

const stripeMock = vi.hoisted(() => ({
  accountsRetrieve: vi.fn(),
  accountsCreate: vi.fn(),
  accountLinksCreate: vi.fn(),
}));

vi.mock('@/libs/stripe', async () => {
  const { default: RealStripe } = await vi.importActual<typeof import('stripe')>('stripe');
  // Unpinned client used ONLY as the source of the real HMAC implementation.
  const unpinned = new RealStripe('sk_test_placeholder');
  const actualModule = await vi.importActual<typeof import('@/libs/stripe')>('@/libs/stripe');
  return {
    stripe: {
      accounts: {
        create: stripeMock.accountsCreate,
        retrieve: stripeMock.accountsRetrieve,
      },
      accountLinks: { create: stripeMock.accountLinksCreate },
      // REAL HMAC — never stub.
      webhooks: unpinned.webhooks,
    },
    // Re-export the REAL pinned constant rather than re-deriving it from an
    // unpinned client, which would silently track the SDK default.
    EXPECTED_STRIPE_API_VERSION: actualModule.EXPECTED_STRIPE_API_VERSION,
  };
});

const { POST } = await import('./route');
const { stripe: mockedStripe } = await import('@/libs/stripe');

// Matches the value `vitest-setup.ts` puts in the environment.
const SECRET = 'ci-placeholder-not-a-secret';
const SALON_ID = 'salon_webhook_fixture';
const ACCOUNT_ID = 'acct_webhook_fixture';

const signer = new Stripe('sk_test_placeholder');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let eventCounter = 0;

function makeEvent(overrides: Record<string, unknown> = {}) {
  eventCounter += 1;
  return {
    id: `evt_test_${eventCounter}`,
    object: 'event',
    api_version: '2024-06-20',
    created: 1786300000,
    type: 'account.updated',
    account: ACCOUNT_ID,
    livemode: false,
    data: { object: { id: ACCOUNT_ID, object: 'account' } },
    ...overrides,
  };
}

function signedRequest(event: Record<string, unknown>, opts?: { secret?: string; mutate?: boolean }) {
  let payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({
    payload,
    secret: opts?.secret ?? SECRET,
  });
  if (opts?.mutate) {
    // Flip one byte of the body AFTER signing.
    payload = `${payload.slice(0, -1)} `;
  }
  return new Request('http://localhost/api/webhooks/stripe-connect', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': header },
  }) as unknown as NextRequest;
}

async function seedBinding(overrides: Partial<typeof schema.salonStripeAccountSchema.$inferInsert> = {}) {
  await db.insert(schema.salonStripeAccountSchema).values({
    id: `sacct_${Math.random().toString(36).slice(2)}`,
    salonId: SALON_ID,
    stripeAccountId: ACCOUNT_ID,
    livemode: false,
    ...overrides,
  });
}

function accountPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    object: 'account',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    country: 'CA',
    controller: {
      stripe_dashboard: { type: 'full' },
      losses: { payments: 'stripe' },
      fees: { payer: 'account' },
      requirement_collection: 'stripe',
    },
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
      current_deadline: null,
      disabled_reason: null,
    },
    metadata: { salonId: SALON_ID },
    ...overrides,
  };
}

async function readEvent(eventId: string) {
  const [row] = await db
    .select()
    .from(schema.stripeWebhookEventSchema)
    .where(eq(schema.stripeWebhookEventSchema.eventId, eventId));
  return row;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Webhook Fixture',
    slug: 'webhook-fixture',
  });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.stripeWebhookEventSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.auditLogSchema);
});

afterEach(async () => {
  await db.delete(schema.stripeWebhookEventSchema);
});

// =============================================================================
// TEST 16 — signature verification with real crypto
// =============================================================================

describe('test 16 — signature verification is real', () => {
  it('(v) constructEvent is NOT a mock', () => {
    expect(vi.isMockFunction(mockedStripe.webhooks.constructEvent)).toBe(false);
  });

  it('(i) a correctly signed body is accepted', async () => {
    await seedBinding();
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload());
    const event = makeEvent();

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);
    expect(await readEvent(event.id)).toBeDefined();
  });

  it('(ii) a mutated body is rejected with 400 and writes NO row', async () => {
    const event = makeEvent();
    const response = await POST(signedRequest(event, { mutate: true }));

    expect(response.status).toBe(400);

    // Recording rows for unverified bodies would be an unbounded write primitive.
    const rows = await db.select().from(schema.stripeWebhookEventSchema);

    expect(rows).toHaveLength(0);
  });

  it('(iii) a body signed with a different secret is rejected', async () => {
    const event = makeEvent();
    const response = await POST(signedRequest(event, { secret: 'whsec_someone_elses_secret' }));

    expect(response.status).toBe(400);
    expect(await db.select().from(schema.stripeWebhookEventSchema)).toHaveLength(0);
  });

  it('(iv) a stale timestamp is rejected by the default tolerance', async () => {
    const event = makeEvent();
    const payload = JSON.stringify(event);
    const header = signer.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 600,
    });
    const request = new Request('http://localhost/api/webhooks/stripe-connect', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': header },
    }) as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(400);
  });
});

// =============================================================================
// TEST 17 — claim, dedupe, reclaim, fence
// =============================================================================

describe('test 17 — claim / dedupe / reclaim / fence', () => {
  it('(a) a valid account.updated syncs readiness and finalizes terminal', async () => {
    await seedBinding({ chargesEnabled: false });
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload());
    const event = makeEvent();

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('processed');
    expect(row?.processedAt).not.toBeNull();

    const [binding] = await db.select().from(schema.salonStripeAccountSchema);

    expect(binding?.chargesEnabled).toBe(true);
  });

  it('(b) redelivering the same event id does not re-dispatch', async () => {
    await seedBinding();
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload());
    const event = makeEvent();

    await POST(signedRequest(event));

    expect(stripeMock.accountsRetrieve).toHaveBeenCalledTimes(1);

    const second = await POST(signedRequest(event));

    expect(second.status).toBe(200);
    expect(stripeMock.accountsRetrieve).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.stripeWebhookEventSchema)).toHaveLength(1);
  });

  it('(c) two concurrent deliveries produce exactly one dispatch and one row', async () => {
    await seedBinding();
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload());
    const event = makeEvent();

    await Promise.all([POST(signedRequest(event)), POST(signedRequest(event))]);

    expect(await db.select().from(schema.stripeWebhookEventSchema)).toHaveLength(1);
    expect(stripeMock.accountsRetrieve).toHaveBeenCalledTimes(1);
  });

  it('(d) a stale `processing` claim is reclaimed by the next delivery', async () => {
    await seedBinding();
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload());
    const event = makeEvent();

    await db.insert(schema.stripeWebhookEventSchema).values({
      id: 'swe_stale',
      eventId: event.id,
      type: 'account.updated',
      account: ACCOUNT_ID,
      livemode: false,
      status: 'processing',
      attempts: 1,
      updatedAt: new Date(Date.now() - 30 * 60_000),
    });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.attempts).toBe(2);
    expect(row?.status).toBe('processed');
  });

  it('(d2) a due failed_retryable row is reclaimed and completed', async () => {
    // A reclaim predicate of only `status = processing` matches ZERO rows here
    // and would strand every retry.
    await seedBinding();
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload());
    const event = makeEvent();

    await db.insert(schema.stripeWebhookEventSchema).values({
      id: 'swe_due',
      eventId: event.id,
      type: 'account.updated',
      account: ACCOUNT_ID,
      livemode: false,
      status: 'failed_retryable',
      attempts: 2,
      availableAt: new Date(Date.now() - 60_000),
    });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.attempts).toBe(3);
    expect(row?.status).toBe('processed');
  });

  it('(d3) a not-yet-due retry is NOT reclaimed and returns 500', async () => {
    await seedBinding();
    const event = makeEvent();

    await db.insert(schema.stripeWebhookEventSchema).values({
      id: 'swe_future',
      eventId: event.id,
      type: 'account.updated',
      account: ACCOUNT_ID,
      livemode: false,
      status: 'failed_retryable',
      attempts: 4,
      availableAt: new Date(Date.now() + 60 * 60_000),
    });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(500);

    const row = await readEvent(event.id);

    expect(row?.attempts).toBe(4);
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('(f) the transient path has NO D2-side terminal and never poisons', async () => {
    // The retry bound is scoped to the UNBOUND path. A generic
    // `attempts >= 8 → poisoned` branch would fork the lifecycle in the very PR
    // that pins it, and this leg goes red the moment one is added.
    await seedBinding();
    const transient = Object.assign(new Error('network down'), {
      type: 'StripeConnectionError',
    });
    stripeMock.accountsRetrieve.mockRejectedValue(transient);
    const event = makeEvent();

    await POST(signedRequest(event));

    for (let attempt = 2; attempt <= 9; attempt += 1) {
      // Make the row due again so the next delivery reclaims it.
      await db
        .update(schema.stripeWebhookEventSchema)
        .set({ availableAt: new Date(Date.now() - 1000) })
        .where(eq(schema.stripeWebhookEventSchema.eventId, event.id));

      const response = await POST(signedRequest(event));
      const row = await readEvent(event.id);

      expect(row?.attempts).toBe(attempt);
      expect(response.status).toBe(500);
      expect(row?.status).toBe('failed_retryable');
      expect(row?.status).not.toBe('poisoned');
      expect(row?.outcome).not.toBe('poisoned');
      expect(row?.outcome).not.toBe('unbound_unresolved');
      expect(row?.processedAt).toBeNull();
    }
  });
});

// =============================================================================
// TEST 18 (route legs) — livemode and scope
// =============================================================================

describe('test 18 — livemode and connect-scope gates', () => {
  it('a livemode-mismatched event terminates as ignored_livemode with no writes', async () => {
    await seedBinding({ chargesEnabled: false });
    const event = makeEvent({ livemode: true });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('ignored_livemode');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();

    const [binding] = await db.select().from(schema.salonStripeAccountSchema);

    expect(binding?.chargesEnabled).toBe(false);
  });

  it('a mismatched event delivered twice yields 200 twice and exactly one row', async () => {
    const event = makeEvent({ livemode: true });

    const first = await POST(signedRequest(event));
    const second = await POST(signedRequest(event));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await db.select().from(schema.stripeWebhookEventSchema)).toHaveLength(1);
  });

  it('an event with no account terminates as ignored_non_connect_scope', async () => {
    // Without this guard the binding lookup would execute with `undefined`.
    const event = makeEvent({ account: undefined });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.outcome).toBe('ignored_non_connect_scope');
    expect(sentry.captureMessage).toHaveBeenCalled();
    expect(await db.select().from(schema.salonStripeAccountSchema)).toHaveLength(0);
  });
});

// =============================================================================
// TEST 19 — unbound account is retryable, then escalates
// =============================================================================

describe('test 19 — unbound account', () => {
  it('(a) first delivery is retryable, not terminal', async () => {
    // A REAL window: accounts.create returns at t0 and the INSERT lands at t0+Δ.
    const event = makeEvent();

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(500);

    const row = await readEvent(event.id);

    expect(row?.status).toBe('failed_retryable');
    expect(row?.outcome).toBe('unbound_account');
    expect(row?.processedAt).toBeNull();
  });

  it('(b) once the binding exists, the same event id converges', async () => {
    const event = makeEvent();
    await POST(signedRequest(event));

    await seedBinding({ chargesEnabled: false });
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload());

    await db
      .update(schema.stripeWebhookEventSchema)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(schema.stripeWebhookEventSchema.eventId, event.id));

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('processed');
  });

  it('(c) at the attempts bound it escalates to terminal unbound_unresolved', async () => {
    const event = makeEvent();

    await db.insert(schema.stripeWebhookEventSchema).values({
      id: 'swe_unbound_cap',
      eventId: event.id,
      type: 'account.updated',
      account: ACCOUNT_ID,
      livemode: false,
      status: 'failed_retryable',
      attempts: 7,
      availableAt: new Date(Date.now() - 1000),
    });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.attempts).toBe(8);
    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('unbound_unresolved');
  });
});

// =============================================================================
// TEST 20 — revoked binding and provider-permanent handling
// =============================================================================

describe('test 20 — revoked binding short-circuit', () => {
  it('a revoked binding terminal-ignores with ZERO provider calls', async () => {
    // Without this arm, retrieve would run against an account we can no longer
    // read → exception → 500 → three days of retries with no cap and no alert.
    await seedBinding({
      revokedAt: new Date('2026-08-01T00:00:00Z'),
      revocationCause: 'deauthorized',
      chargesEnabled: false,
    });
    const event = makeEvent();

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();

    const row = await readEvent(event.id);

    expect(row?.outcome).toBe('ignored_revoked_binding');
  });

  it('a permanent provider error revokes with cause deauthorized and returns 200', async () => {
    await seedBinding({ chargesEnabled: true });
    stripeMock.accountsRetrieve.mockRejectedValue(
      Object.assign(new Error('no such account'), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        statusCode: 404,
      }),
    );
    const event = makeEvent();

    const response = await POST(signedRequest(event));

    // 200, not 500: retrying cannot help.
    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.outcome).toBe('permanent_provider_error');

    const [binding] = await db.select().from(schema.salonStripeAccountSchema);

    expect(binding?.revokedAt).not.toBeNull();
    expect(binding?.revocationCause).toBe('deauthorized');
    expect(binding?.chargesEnabled).toBe(false);
  });

  it('a ROW-level livemode mismatch is terminal, not retryable', async () => {
    // The event-level gate has already passed here; this is the row-level
    // discriminator. `failed_retryable` is the one wrong answer — a retry cannot
    // change a stored column.
    await seedBinding({ livemode: true, chargesEnabled: false });
    const event = makeEvent({ livemode: false });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();

    const row = await readEvent(event.id);

    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('ignored_livemode');
    // What lets a runbook separate this population from the event-level gate.
    expect(row?.lastError).toBe('binding_livemode_mismatch');

    const [binding] = await db.select().from(schema.salonStripeAccountSchema);

    expect(binding?.lastSyncedAt).toBeNull();
    expect(binding?.chargesEnabled).toBe(false);
  });
});

// =============================================================================
// TEST 21 — deauthorization idempotency and the three-way partition
// =============================================================================

describe('test 21 — account.application.deauthorized', () => {
  it('revokes once and is side-effect-free on redelivery', async () => {
    await seedBinding({ chargesEnabled: true });
    const first = makeEvent({ type: 'account.application.deauthorized' });

    await POST(signedRequest(first));

    const [binding] = await db.select().from(schema.salonStripeAccountSchema);

    expect(binding?.revocationCause).toBe('deauthorized');

    const auditsAfterFirst = await db
      .select()
      .from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.action, 'stripe_connect_account_revoked'));

    expect(auditsAfterFirst).toHaveLength(1);

    // A DIFFERENT event id for the same already-revoked account.
    const second = makeEvent({ type: 'account.application.deauthorized' });
    const response = await POST(signedRequest(second));

    expect(response.status).toBe(200);

    const auditsAfterSecond = await db
      .select()
      .from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.action, 'stripe_connect_account_revoked'));

    // Rule W-SE: side effects are gated on the CAS affecting exactly one row.
    expect(auditsAfterSecond).toHaveLength(1);
  });

  it('(a) rows exist but none is live → ignored_revoked_binding, zero CAS', async () => {
    await seedBinding({
      revokedAt: new Date('2026-08-01T00:00:00Z'),
      revocationCause: 'revoked_local',
    });
    const event = makeEvent({ type: 'account.application.deauthorized' });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.outcome).toBe('ignored_revoked_binding');

    const [binding] = await db.select().from(schema.salonStripeAccountSchema);

    // Untouched: the cause stays the original one.
    expect(binding?.revocationCause).toBe('revoked_local');
  });

  it('(b) no row at all → unbound_unresolved, zero CAS, zero audit rows', async () => {
    // Deliberately NOT ignored_revoked_binding: conflating the two populations
    // poisons the runbook query for "events for accounts we have no record of".
    const event = makeEvent({ type: 'account.application.deauthorized' });

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.status).toBe('processed');
    expect(row?.outcome).toBe('unbound_unresolved');
    expect(await db.select().from(schema.auditLogSchema)).toHaveLength(0);
    expect(sentry.captureMessage).toHaveBeenCalled();
  });
});

// =============================================================================
// SAFE DISABLE + TEST 34(e1)
// =============================================================================

describe('safe disable', () => {
  it('still verifies and PERSISTS the event, retryable, when dispatch is disabled', async () => {
    // This replaces "blank the secret to disable". The receipt layer must never
    // be switchable off: Stripe never redelivers a 2xx-acked event.
    vi.stubEnv('DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED', 'false');
    const { Env } = await import('@/libs/Env');
    const spy = vi
      .spyOn(Env, 'DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED', 'get')
      .mockReturnValue('false');

    await seedBinding();
    const event = makeEvent();

    const response = await POST(signedRequest(event));

    expect(response.status).toBe(200);

    const row = await readEvent(event.id);

    expect(row?.status).toBe('failed_retryable');
    expect(row?.outcome).toBe('disabled_by_flag');
    expect(row?.availableAt).not.toBeNull();
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();

    spy.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe('test 34(e1) — every terminal row carries a non-null outcome', () => {
  it('holds across the terminal arms of the dispatch', async () => {
    const cases: { setup: () => Promise<void>; event: Record<string, unknown>; outcome: string }[] = [
      {
        setup: async () => {},
        event: makeEvent({ livemode: true }),
        outcome: 'ignored_livemode',
      },
      {
        setup: async () => {},
        event: makeEvent({ account: undefined }),
        outcome: 'ignored_non_connect_scope',
      },
      {
        setup: async () => {},
        event: makeEvent({ type: 'account.external_account.created' }),
        outcome: 'ignored_unhandled',
      },
      {
        setup: async () => {
          await seedBinding({
            revokedAt: new Date('2026-08-01T00:00:00Z'),
            revocationCause: 'revoked_local',
          });
        },
        event: makeEvent(),
        outcome: 'ignored_revoked_binding',
      },
      {
        setup: async () => {
          await seedBinding();
          stripeMock.accountsRetrieve.mockResolvedValue(accountPayload());
        },
        event: makeEvent(),
        outcome: 'processed',
      },
    ];

    for (const testCase of cases) {
      await db.delete(schema.salonStripeAccountSchema);
      await testCase.setup();

      const response = await POST(signedRequest(testCase.event));
      const row = await readEvent(testCase.event.id as string);

      expect(response.status).toBe(200);
      expect(row?.status).toBe('processed');
      expect(row?.outcome).toBe(testCase.outcome);
      expect(row?.outcome).not.toBeNull();
    }
  });
});
