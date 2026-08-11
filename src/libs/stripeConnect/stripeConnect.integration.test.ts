/**
 * Binding identity and readiness, against the real DDL on PGlite
 * (charter tests 5, 7, 11, 12, 13, 14, 15).
 *
 * Everything whose assertion is about a SQL predicate runs here rather than
 * against a mocked drizzle chain: a mocked chain can only observe THAT
 * `.where()` was called, so deleting a CAS predicate would not fail it.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

// Type-only, so it is erased and cannot self-reference the mocked module.
import type { SalonStripeBinding } from './readiness';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const stripeMock = vi.hoisted(() => ({
  accountsCreate: vi.fn(),
  accountsRetrieve: vi.fn(),
  accountLinksCreate: vi.fn(),
}));

vi.mock('@/libs/stripe', async () => {
  const { default: RealStripe } = await vi.importActual<typeof import('stripe')>('stripe');
  const unpinned = new RealStripe('sk_test_placeholder');
  const actualModule = await vi.importActual<typeof import('@/libs/stripe')>('@/libs/stripe');
  return {
    stripe: {
      accounts: { create: stripeMock.accountsCreate, retrieve: stripeMock.accountsRetrieve },
      accountLinks: { create: stripeMock.accountLinksCreate },
      webhooks: unpinned.webhooks,
    },
    EXPECTED_STRIPE_API_VERSION: actualModule.EXPECTED_STRIPE_API_VERSION,
  };
});

const {
  buildConnectIdempotencyKey,
  ensureConnectedAccount,
  getSalonBindings,
  revokeBinding,
} = await import('./binding');
const {
  ACTION_SOON_DAYS,
  deriveConnectStatus,
  expectedLivemode,
  getAccountReadinessForDisplay,
  refreshAccountReadiness,
  syncAccountReadiness,
  toBinding,
} = await import('./readiness');

const SALON_A = 'salon_bind_a';
const SALON_B = 'salon_bind_b';
const ACTOR = { actorId: 'admin_1', viaSuperAdminWithoutMembership: false };

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function accountPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acct_created',
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
    metadata: {},
    ...overrides,
  };
}

async function loadBinding(salonId: string): Promise<SalonStripeBinding> {
  const rows = await getSalonBindings(salonId);
  const live = rows.find(row => row.revokedAt === null);
  if (!live) {
    throw new Error('no live binding');
  }
  return live;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  for (const [id, slug] of [[SALON_A, 'bind-a'], [SALON_B, 'bind-b']]) {
    await db.insert(schema.salonSchema).values({ id: id!, name: 'Bind', slug: slug! });
  }
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.auditLogSchema);
});

// =============================================================================
// TEST 5 — idempotency key generation
// =============================================================================

describe('test 5 — BIND-4 idempotency key', () => {
  it('embeds environment, salon and generation', () => {
    expect(buildConnectIdempotencyKey({
      runtimeEnvironment: 'test',
      salonId: SALON_A,
      generation: 0,
    })).toBe(`luster:connect:acct:v1:test:${SALON_A}:0`);
  });

  it('two runtime environments produce different keys', () => {
    // Stops a preview create from silently returning the dev account when both
    // share one test-mode platform account.
    const dev = buildConnectIdempotencyKey({
      runtimeEnvironment: 'development',
      salonId: SALON_A,
      generation: 0,
    });
    const preview = buildConnectIdempotencyKey({
      runtimeEnvironment: 'preview',
      salonId: SALON_A,
      generation: 0,
    });

    expect(dev).not.toBe(preview);
  });

  it('a retry at the same generation reuses the key; a re-bind does not', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_gen0' }));
    await ensureConnectedAccount({
      salonId: SALON_A,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });
    const firstKey = stripeMock.accountsCreate.mock.calls[0]?.[1]?.idempotencyKey;

    expect(firstKey).toBe(`luster:connect:acct:v1:test:${SALON_A}:0`);

    const binding = await loadBinding(SALON_A);
    await revokeBinding(binding.id, 'revoked_local', {
      ...ACTOR,
      salonId: SALON_A,
      stripeAccountId: binding.stripeAccountId,
    });

    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_gen1' }));
    await ensureConnectedAccount({
      salonId: SALON_A,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });
    const secondKey = stripeMock.accountsCreate.mock.calls[1]?.[1]?.idempotencyKey;

    // The row count is higher, so the key differs and Stripe creates a genuinely
    // new account. A stable per-salon key would make re-bind a no-op for 24h.
    expect(secondKey).toBe(`luster:connect:acct:v1:test:${SALON_A}:1`);
    expect(secondKey).not.toBe(firstKey);
  });
});

// =============================================================================
// TEST 7 — re-bind is append-only
// =============================================================================

describe('test 7 — BIND-3 append-only identity', () => {
  it('bind → revoke → bind leaves two rows, one live, old id preserved', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_first' }));
    await ensureConnectedAccount({ salonId: SALON_A, runtimeEnvironment: 'test', actor: ACTOR });

    const first = await loadBinding(SALON_A);
    await revokeBinding(first.id, 'revoked_local', {
      ...ACTOR,
      salonId: SALON_A,
      stripeAccountId: first.stripeAccountId,
    });

    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_second' }));
    await ensureConnectedAccount({ salonId: SALON_A, runtimeEnvironment: 'test', actor: ACTOR });

    const rows = await getSalonBindings(SALON_A);

    expect(rows).toHaveLength(2);
    expect(rows.filter(row => row.revokedAt === null)).toHaveLength(1);

    const old = rows.find(row => row.id === first.id);

    // The superseded row keeps its identity and its cause — nothing is updated
    // in place, so a lookup by the OLD account id still resolves to this salon.
    expect(old?.stripeAccountId).toBe('acct_first');
    expect(old?.revocationCause).toBe('revoked_local');

    const live = rows.find(row => row.revokedAt === null);

    expect(live?.stripeAccountId).toBe('acct_second');
  });

  it('an existing live binding resumes without creating', async () => {
    // TEST 8 — resume does not create.
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_resume' }));
    await ensureConnectedAccount({ salonId: SALON_A, runtimeEnvironment: 'test', actor: ACTOR });

    expect(stripeMock.accountsCreate).toHaveBeenCalledTimes(1);

    const result = await ensureConnectedAccount({
      salonId: SALON_A,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });

    expect(stripeMock.accountsCreate).toHaveBeenCalledTimes(1);
    expect(result.ok && result.created).toBe(false);
  });
});

// =============================================================================
// TEST 11 — 23505 classification against a REAL Postgres error
// =============================================================================

describe('test 11 — BIND-2 unique-violation classification', () => {
  it('(a) an account already live under ANOTHER salon fails closed', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_shared' }));
    await ensureConnectedAccount({ salonId: SALON_A, runtimeEnvironment: 'test', actor: ACTOR });

    // Salon B's create stub returns the SAME account id.
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_shared' }));
    const result = await ensureConnectedAccount({
      salonId: SALON_B,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('CONNECT_BINDING_INTEGRITY');
    // No binding row for salon B.
    expect(await getSalonBindings(SALON_B)).toHaveLength(0);

    const audits = await db.select().from(schema.auditLogSchema);

    expect(audits.length).toBeGreaterThan(0);
  });

  it('(b) the same returned id twice is idempotent with no orphan audit', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_same' }));

    const first = await ensureConnectedAccount({
      salonId: SALON_A,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });
    const second = await ensureConnectedAccount({
      salonId: SALON_A,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await getSalonBindings(SALON_A)).toHaveLength(1);

    const orphans = await db
      .select()
      .from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.action, 'stripe_connect_orphan_account'));

    expect(orphans).toHaveLength(0);
  });
});

// =============================================================================
// TEST 6 — replay refusal
// =============================================================================

describe('test 6 — replay refusal', () => {
  it('refuses when the created id already exists on a revoked row', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_replay' }));
    await ensureConnectedAccount({ salonId: SALON_A, runtimeEnvironment: 'test', actor: ACTOR });

    const binding = await loadBinding(SALON_A);
    await revokeBinding(binding.id, 'revoked_local', {
      ...ACTOR,
      salonId: SALON_A,
      stripeAccountId: binding.stripeAccountId,
    });
    await db.delete(schema.auditLogSchema);

    // The re-bind's create returns an id we have already seen.
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_replay' }));
    const result = await ensureConnectedAccount({
      salonId: SALON_A,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('CONNECT_CREATE_REPLAYED');
    // Nothing persisted, and NO rebind audit.
    expect(await getSalonBindings(SALON_A)).toHaveLength(1);

    const rebinds = await db
      .select()
      .from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.action, 'stripe_connect_account_rebound'));

    expect(rebinds).toHaveLength(0);
  });
});

// =============================================================================
// TEST 4 — post-create shape assertion
// =============================================================================

describe('test 4 — a wrong controller shape is never persisted', () => {
  it('rejects an express-dashboard account and writes no row', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({
      id: 'acct_express',
      controller: {
        stripe_dashboard: { type: 'express' },
        losses: { payments: 'stripe' },
        fees: { payer: 'account' },
        requirement_collection: 'stripe',
      },
    }));

    const result = await ensureConnectedAccount({
      salonId: SALON_A,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('CONNECT_ACCOUNT_SHAPE_REJECTED');
    // The created account is orphaned and inert: no binding row means no code
    // path can charge on it.
    expect(await getSalonBindings(SALON_A)).toHaveLength(0);
  });

  it('rejects an account whose losses are on the platform', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({
      id: 'acct_losses',
      controller: {
        stripe_dashboard: { type: 'full' },
        losses: { payments: 'application' },
        fees: { payer: 'account' },
        requirement_collection: 'stripe',
      },
    }));

    const result = await ensureConnectedAccount({
      salonId: SALON_A,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });

    expect(!result.ok && result.code).toBe('CONNECT_ACCOUNT_SHAPE_REJECTED');
    expect(await getSalonBindings(SALON_A)).toHaveLength(0);
  });
});

// =============================================================================
// TEST 3 — create-call shape
// =============================================================================

describe('test 3 — the create call carries the explicit controller block', () => {
  it('passes country, controller, metadata and the generation-scoped key', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_shape' }));

    await ensureConnectedAccount({
      salonId: SALON_A,
      runtimeEnvironment: 'test',
      actor: ACTOR,
    });

    expect(stripeMock.accountsCreate).toHaveBeenCalledWith(
      {
        country: 'CA',
        controller: {
          losses: { payments: 'stripe' },
          fees: { payer: 'account' },
          requirement_collection: 'stripe',
          stripe_dashboard: { type: 'full' },
        },
        metadata: { salonId: SALON_A, luster_env: 'test' },
      },
      { idempotencyKey: `luster:connect:acct:v1:test:${SALON_A}:0` },
    );

    const params = stripeMock.accountsCreate.mock.calls[0]?.[0];

    // No `type`, no `capabilities`, and no application fee plumbing.
    expect(params).not.toHaveProperty('type');
    expect(params).not.toHaveProperty('capabilities');
    expect(params).not.toHaveProperty('application_fee_amount');
  });
});

// =============================================================================
// TEST 12 — readiness gate contract
// =============================================================================

describe('test 12 — READY-2 decision-time gate', () => {
  beforeEach(async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_ready' }));
    await ensureConnectedAccount({ salonId: SALON_A, runtimeEnvironment: 'test', actor: ACTOR });
    vi.clearAllMocks();
  });

  it('(a) ALWAYS retrieves, even when the cached row is one minute old', async () => {
    await db
      .update(schema.salonStripeAccountSchema)
      .set({ lastSyncedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.salonStripeAccountSchema.salonId, SALON_A));

    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload({ id: 'acct_ready' }));

    await refreshAccountReadiness(SALON_A);

    // A gate must never be able to receive a cached ready value.
    expect(stripeMock.accountsRetrieve).toHaveBeenCalledTimes(1);
  });

  it('(b) THROWS on a provider failure, leaving the row unmodified', async () => {
    const before = await loadBinding(SALON_A);
    stripeMock.accountsRetrieve.mockRejectedValue(
      Object.assign(new Error('boom'), { type: 'StripeConnectionError' }),
    );

    await expect(refreshAccountReadiness(SALON_A)).rejects.toThrow();

    const after = await loadBinding(SALON_A);

    expect(after).toEqual(before);
  });

  it('(b) display resolves stale instead of throwing', async () => {
    stripeMock.accountsRetrieve.mockRejectedValue(
      Object.assign(new Error('boom'), { type: 'StripeConnectionError' }),
    );

    const display = await getAccountReadinessForDisplay(SALON_A);

    expect(display.stale).toBe(true);
    expect(display.decision.chargeReady).toBe(false);
  });

  it('(c) a revoked binding is never charge-ready, even with charges_enabled', async () => {
    const binding = await loadBinding(SALON_A);
    await db
      .update(schema.salonStripeAccountSchema)
      .set({ revokedAt: new Date(), revocationCause: 'revoked_local', chargesEnabled: true })
      .where(eq(schema.salonStripeAccountSchema.id, binding.id));

    const decision = await refreshAccountReadiness(SALON_A);

    expect(decision.chargeReady).toBe(false);
    expect(decision.status).toBe('not_connected');
  });

  it('(d) a livemode mismatch short-circuits with NO provider call', async () => {
    await db
      .update(schema.salonStripeAccountSchema)
      .set({ livemode: true })
      .where(eq(schema.salonStripeAccountSchema.salonId, SALON_A));

    const decision = await refreshAccountReadiness(SALON_A);

    expect(decision.status).toBe('mode_mismatch');
    expect(decision.chargeReady).toBe(false);
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();
  });
});

// =============================================================================
// TEST 13 — derived status coverage, including the ACTION_SOON_DAYS boundary
// =============================================================================

describe('test 13 — deriveConnectStatus', () => {
  const base: SalonStripeBinding = {
    id: 'b1',
    salonId: SALON_A,
    stripeAccountId: 'acct_x',
    livemode: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirements: {
      currentlyDue: [],
      eventuallyDue: [],
      pastDue: [],
      pendingVerification: [],
      currentDeadline: null,
      futureCurrentDeadline: null,
    },
    disabledReason: null,
    connectedAt: new Date(),
    revokedAt: null,
    revocationCause: null,
    lastSyncedAt: null,
  };

  it('null → not_connected', () => {
    expect(deriveConnectStatus(null, false)).toBe('not_connected');
  });

  it('the dead end is blocked_needs_support, NOT onboarding_incomplete', () => {
    // Everything submitted, nothing outstanding, charges still off. Rendering
    // "Resume onboarding" here would be a loop.
    expect(deriveConnectStatus({
      ...base,
      chargesEnabled: false,
      detailsSubmitted: true,
      disabledReason: null,
    }, false)).toBe('blocked_needs_support');
  });

  it('a non-empty eventuallyDue on a charging account is action_needed_soon', () => {
    expect(deriveConnectStatus({
      ...base,
      chargesEnabled: true,
      requirements: { ...base.requirements, eventuallyDue: ['company.tax_id'] },
    }, false)).toBe('action_needed_soon');
  });

  it('disabled_reason wins as restricted', () => {
    expect(deriveConnectStatus({ ...base, disabledReason: 'requirements.past_due' }, false))
      .toBe('restricted');
  });

  it('a stored livemode disagreement is mode_mismatch', () => {
    expect(deriveConnectStatus({ ...base, livemode: true }, false)).toBe('mode_mismatch');
  });

  it('the ACTION_SOON_DAYS threshold is asserted at its BOUNDARY', () => {
    const day = 24 * 60 * 60 * 1000;

    const atNMinusOne = deriveConnectStatus({
      ...base,
      chargesEnabled: true,
      requirements: {
        ...base.requirements,
        currentDeadline: new Date(Date.now() + 13 * day),
      },
    }, false);
    const atNPlusOne = deriveConnectStatus({
      ...base,
      chargesEnabled: true,
      requirements: {
        ...base.requirements,
        currentDeadline: new Date(Date.now() + 15 * day),
      },
    }, false);

    expect(atNMinusOne).toBe('action_needed_soon');
    expect(atNPlusOne).toBe('charge_ready');

    // Against BOTH the exported const and the hardcoded literal, so changing the
    // constant alone fails rather than silently re-baselining the threshold.
    expect(ACTION_SOON_DAYS).toBe(14);
  });
});

// =============================================================================
// TEST 14 — requirements are stored whole
// =============================================================================

describe('test 14 — the whole requirements object survives a sync', () => {
  it('persists every field and does not report charge_ready', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_req' }));
    await ensureConnectedAccount({ salonId: SALON_A, runtimeEnvironment: 'test', actor: ACTOR });

    const deadline = 1795000000;
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload({
      id: 'acct_req',
      charges_enabled: false,
      requirements: {
        currently_due: [],
        eventually_due: ['company.tax_id'],
        past_due: ['individual.id_number'],
        pending_verification: ['individual.dob'],
        current_deadline: deadline,
        disabled_reason: 'requirements.past_due',
      },
    }));

    const decision = await refreshAccountReadiness(SALON_A);

    const [row] = await db.select().from(schema.salonStripeAccountSchema);

    // Storing only `currently_due` would discard past_due at exactly the moment
    // a restricted salon needs to see it.
    expect(row?.requirementsDue).toMatchObject({
      eventually_due: ['company.tax_id'],
      past_due: ['individual.id_number'],
      pending_verification: ['individual.dob'],
      current_deadline: deadline,
      disabled_reason: 'requirements.past_due',
    });
    expect(row?.disabledReason).toBe('requirements.past_due');
    expect(decision.status).not.toBe('charge_ready');
  });
});

// =============================================================================
// TEST 15 — READY-3 staleness CAS and revocation guard
// =============================================================================

describe('test 15 — the sync CAS is monotone and revocation-aware', () => {
  it('an out-of-order sync cannot overwrite newer data', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_cas' }));
    await ensureConnectedAccount({ salonId: SALON_A, runtimeEnvironment: 'test', actor: ACTOR });
    const binding = await loadBinding(SALON_A);

    // Apply T2 first…
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload({
      id: 'acct_cas',
      charges_enabled: true,
      requirements: { currently_due: ['t2'], eventually_due: [], past_due: [], pending_verification: [], current_deadline: null, disabled_reason: null },
    }));
    await syncAccountReadiness(binding);

    const afterT2 = await loadBinding(SALON_A);

    expect(afterT2.requirements.currentlyDue).toEqual(['t2']);

    // …then a straggler whose fetchedAt is older. Its write must not land.
    await db
      .update(schema.salonStripeAccountSchema)
      .set({ lastSyncedAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.salonStripeAccountSchema.id, binding.id));

    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload({
      id: 'acct_cas',
      charges_enabled: true,
      requirements: { currently_due: ['t1'], eventually_due: [], past_due: [], pending_verification: [], current_deadline: null, disabled_reason: null },
    }));
    await syncAccountReadiness(afterT2);

    const [row] = await db.select().from(schema.salonStripeAccountSchema);

    expect(toBinding(row!).requirements.currentlyDue).toEqual(['t2']);
  });

  it('a sync cannot write charges_enabled back onto a REVOKED binding', async () => {
    // Luster's disconnect is a local unlink: the account stays perfectly
    // charge-enabled at Stripe, so the retrieve legitimately returns true.
    stripeMock.accountsCreate.mockResolvedValue(accountPayload({ id: 'acct_revoked_cas' }));
    await ensureConnectedAccount({ salonId: SALON_A, runtimeEnvironment: 'test', actor: ACTOR });
    const binding = await loadBinding(SALON_A);

    await revokeBinding(binding.id, 'revoked_local', {
      ...ACTOR,
      salonId: SALON_A,
      stripeAccountId: binding.stripeAccountId,
    });

    stripeMock.accountsRetrieve.mockResolvedValue(
      accountPayload({ id: 'acct_revoked_cas', charges_enabled: true }),
    );
    await syncAccountReadiness(binding);

    const [row] = await db.select().from(schema.salonStripeAccountSchema);

    expect(row?.chargesEnabled).toBe(false);
    expect(row?.revokedAt).not.toBeNull();
  });
});

describe('expected livemode under vitest', () => {
  it('resolves to test mode from two agreeing offline legs', () => {
    expect(expectedLivemode()).toBe(false);
  });
});
