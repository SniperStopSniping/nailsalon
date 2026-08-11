/**
 * Connect binding + readiness contracts (charter tests 5, 12, 13).
 *
 * Test 5 covers the idempotency key, whose two components each prevent a
 * distinct production failure. Test 12 pins the readiness gate as a gate — it
 * must ask the provider, and must never report readiness it did not just
 * observe. Test 13 pins the derived status table, including the dead end that
 * looks like incomplete onboarding but is not.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

// Type-only, so it is erased at transform time and does not defeat the
// `vi.mock` hoisting the runtime imports below depend on.
import type { SalonStripeBinding } from './readiness';

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

const { buildConnectIdempotencyKey, ensureConnectedAccount, revokeBinding } = await import('./binding');
const {
  ACTION_SOON_DAYS,
  deriveConnectStatus,
  expectedLivemode,
  getAccountReadinessForDisplay,
  refreshAccountReadiness,
} = await import('./readiness');

const SALON = 'salon_sc_a';
const ACTOR = { actorId: 'admin_1', viaSuperAdminWithoutMembership: false };

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function accountPayload(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: 'account',
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
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

function binding(overrides: Partial<SalonStripeBinding> = {}): SalonStripeBinding {
  return {
    id: 'sacct_1',
    salonId: SALON,
    stripeAccountId: 'acct_1',
    livemode: expectedLivemode(),
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
    connectedAt: new Date('2026-08-01T00:00:00Z'),
    revokedAt: null,
    revocationCause: null,
    lastSyncedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

async function seedBinding(values: Partial<typeof schema.salonStripeAccountSchema.$inferInsert> = {}) {
  await db.insert(schema.salonStripeAccountSchema).values({
    id: 'sacct_live',
    salonId: SALON,
    stripeAccountId: 'acct_live',
    livemode: expectedLivemode(),
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    ...values,
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({ id: SALON, name: 'SC', slug: 'sc-a' });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.auditLogSchema);
});

// =============================================================================
// TEST 5 — idempotency key generation
// =============================================================================

describe('test 5 — the create idempotency key', () => {
  it('is scoped by BOTH runtime environment and generation', () => {
    const base = { salonId: SALON, generation: 0 };

    // The generation component makes a re-bind actually re-bind. A stable
    // per-salon key would replay the SAME account for 24h, handing a
    // deauthorized salon back the account the platform can no longer act on.
    expect(buildConnectIdempotencyKey({ ...base, runtimeEnvironment: 'production' }))
      .not.toBe(buildConnectIdempotencyKey({ ...base, generation: 1, runtimeEnvironment: 'production' }));

    // The environment component stops a preview create from silently returning
    // the dev account when dev and preview share one test-mode platform account.
    expect(buildConnectIdempotencyKey({ ...base, runtimeEnvironment: 'preview' }))
      .not.toBe(buildConnectIdempotencyKey({ ...base, runtimeEnvironment: 'development' }));
  });

  it('is stable for the same environment and generation, so a retry replays', () => {
    const input = { runtimeEnvironment: 'production', salonId: SALON, generation: 0 };

    // Crash self-heal: a create that succeeded while the INSERT failed leaves
    // the row count unchanged, so the retry sends the same key and Stripe
    // returns the same account rather than orphaning a second one.
    expect(buildConnectIdempotencyKey(input)).toBe(buildConnectIdempotencyKey({ ...input }));
  });

  it('is not a bare per-salon key', () => {
    // Falsification target: `luster:connect:acct:<salonId>`.
    const key = buildConnectIdempotencyKey({
      runtimeEnvironment: 'production',
      salonId: SALON,
      generation: 0,
    });

    expect(key).not.toBe(`luster:connect:acct:${SALON}`);
    expect(key).toContain('production');
    expect(key).toContain('0');
  });

  it('the first bind uses generation 0 and a revoked re-bind uses a different key', async () => {
    stripeMock.accountsCreate.mockResolvedValue(accountPayload('acct_gen0'));

    await ensureConnectedAccount({ salonId: SALON, runtimeEnvironment: 'production', actor: ACTOR });

    const firstKey = stripeMock.accountsCreate.mock.calls[0]?.[1]?.idempotencyKey;

    expect(firstKey).toBe(buildConnectIdempotencyKey({
      runtimeEnvironment: 'production',
      salonId: SALON,
      generation: 0,
    }));

    const [live] = await db.select().from(schema.salonStripeAccountSchema);
    await revokeBinding(live!.id, 'revoked_local', {
      ...ACTOR,
      salonId: SALON,
      stripeAccountId: live!.stripeAccountId,
    });

    stripeMock.accountsCreate.mockResolvedValue(accountPayload('acct_gen1'));
    await ensureConnectedAccount({ salonId: SALON, runtimeEnvironment: 'production', actor: ACTOR });

    const secondKey = stripeMock.accountsCreate.mock.calls[1]?.[1]?.idempotencyKey;

    expect(secondKey).not.toBe(firstKey);
  });
});

// =============================================================================
// TEST 12 — readiness gate contract
// =============================================================================

describe('test 12 — the readiness gate is a gate, not a cache read', () => {
  it('(a) still calls accounts.retrieve on a binding synced one minute ago', async () => {
    // A cached read here would let a salon whose account Stripe disabled 30
    // seconds ago keep taking deposits.
    await seedBinding({ lastSyncedAt: new Date(Date.now() - 60_000) });
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload('acct_live'));

    await refreshAccountReadiness(SALON);

    expect(stripeMock.accountsRetrieve).toHaveBeenCalledTimes(1);
  });

  it('(b) throws when the provider rejects, and leaves the row unmodified', async () => {
    await seedBinding({ chargesEnabled: false, lastSyncedAt: null });
    stripeMock.accountsRetrieve.mockRejectedValue(new Error('stripe down'));

    await expect(refreshAccountReadiness(SALON)).rejects.toThrow();

    const [row] = await db.select().from(schema.salonStripeAccountSchema);

    expect(row?.chargesEnabled).toBe(false);
    expect(row?.lastSyncedAt).toBeNull();
  });

  it('(b) the DISPLAY path degrades instead of throwing, and never claims readiness', async () => {
    // The two callers have opposite needs: a money decision must fail loudly,
    // a settings screen must still render.
    await seedBinding({ chargesEnabled: true, lastSyncedAt: new Date('2026-07-01T00:00:00Z') });
    stripeMock.accountsRetrieve.mockRejectedValue(new Error('stripe down'));

    const display = await getAccountReadinessForDisplay(SALON);

    expect(display.stale).toBe(true);
    expect(display.decision.chargeReady).toBe(false);
  });

  it('(c) a revoked binding is never charge-ready, even with charges enabled', async () => {
    await seedBinding({
      chargesEnabled: true,
      detailsSubmitted: true,
      revokedAt: new Date('2026-08-02T00:00:00Z'),
      revocationCause: 'deauthorized',
    });

    const display = await getAccountReadinessForDisplay(SALON);

    expect(display.decision.chargeReady).toBe(false);
  });

  it('(d) a livemode mismatch short-circuits before any provider call', async () => {
    // Charging a test-mode account in production takes real money from a real
    // client into an account that cannot settle it.
    await seedBinding({ livemode: !expectedLivemode(), chargesEnabled: true });

    const decision = await refreshAccountReadiness(SALON);

    expect(decision.chargeReady).toBe(false);
    expect(decision.status).toBe('mode_mismatch');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();
  });
});

// =============================================================================
// TEST 13 — derived status coverage
// =============================================================================

describe('test 13 — deriveConnectStatus', () => {
  const expected = () => expectedLivemode();

  it('charges disabled with onboarding COMPLETE and nothing due is a dead end, not incomplete onboarding', () => {
    // The owner has submitted everything and Stripe still will not enable
    // charges. Telling them to "finish onboarding" sends them in a loop; this
    // population needs support, and the status has to say so.
    const status = deriveConnectStatus(
      binding({ chargesEnabled: false, detailsSubmitted: true, disabledReason: null }),
      expected(),
    );

    expect(status).toBe('blocked_needs_support');
    expect(status).not.toBe('onboarding_incomplete');
  });

  it('a non-empty eventuallyDue is action_needed_soon', () => {
    const status = deriveConnectStatus(
      binding({
        chargesEnabled: true,
        detailsSubmitted: true,
        requirements: { ...binding().requirements, eventuallyDue: ['company.tax_id'] },
      }),
      expected(),
    );

    expect(status).toBe('action_needed_soon');
  });

  it('charges enabled with payouts disabled is charge_ready', () => {
    // Payouts pending is a settlement-timing fact, not a charging blocker.
    const status = deriveConnectStatus(
      binding({ chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true }),
      expected(),
    );

    expect(status).toBe('charge_ready');
  });

  it('a revoked binding derives revoked', () => {
    const status = deriveConnectStatus(
      binding({
        chargesEnabled: true,
        detailsSubmitted: true,
        revokedAt: new Date('2026-08-02T00:00:00Z'),
        revocationCause: 'deauthorized',
      }),
      expected(),
    );

    expect(status).toBe('revoked');
  });

  it('a stored livemode that disagrees derives mode_mismatch', () => {
    const status = deriveConnectStatus(
      binding({ chargesEnabled: true, detailsSubmitted: true, livemode: !expected() }),
      expected(),
    );

    expect(status).toBe('mode_mismatch');
  });

  describe('the ACTION_SOON_DAYS threshold, asserted at its BOUNDARY', () => {
    function withDeadline(daysFromNow: number) {
      return binding({
        chargesEnabled: true,
        detailsSubmitted: true,
        requirements: {
          ...binding().requirements,
          eventuallyDue: [],
          currentDeadline: new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000),
        },
      });
    }

    it('N-1 days out is action_needed_soon and N+1 days out is charge_ready', () => {
      // Asserted at the boundary rather than "near" it: a "near" test enshrines
      // whatever threshold the implementation happened to pick and can never
      // catch a wrong one.
      expect(deriveConnectStatus(withDeadline(ACTION_SOON_DAYS - 1), expected()))
        .toBe('action_needed_soon');
      expect(deriveConnectStatus(withDeadline(ACTION_SOON_DAYS + 1), expected()))
        .toBe('charge_ready');
    });

    it('the constant is 14, asserted against the literal as well as the export', () => {
      // Both halves are required: the export assertion catches an inlined
      // number, and the literal assertion catches a changed constant.
      expect(ACTION_SOON_DAYS).toBe(14);
      expect(deriveConnectStatus(withDeadline(13), expected())).toBe('action_needed_soon');
      expect(deriveConnectStatus(withDeadline(15), expected())).toBe('charge_ready');
    });
  });
});
