/**
 * Genuine concurrency on the bind path (charter test 32).
 *
 * PGlite runs on a single connection, so two `ensureConnectedAccount` calls can
 * never actually interleave there — it cannot prove that the self-guarding
 * INSERT and the `23505` classification hold under a real race. This suite
 * drives the real function against a throwaway PostgreSQL server over a real
 * connection pool.
 *
 * The race being proven: two admins double-click Connect. Both reach Stripe,
 * both get a DISTINCT account back (the idempotency key only collapses retries
 * within one generation, not two concurrent first-creates that each read
 * generation 0). Exactly one row may survive, both callers must be told about
 * the SAME account, and the loser's account must be recorded as an orphan so it
 * can be reconciled — never silently overwritten.
 *
 * It is opt-in and refuses to run against anything that is not an explicitly
 * local throwaway database:
 *
 *   docker run -d --name luster-qa-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=qa \
 *     -e POSTGRES_DB=luster_qa -p 55432:5432 postgres:16
 *   CONCURRENCY_TEST_DATABASE_URL=postgres://qa@127.0.0.1:55432/luster_qa \
 *     npx vitest run src/libs/stripeConnect/stripeConnect.concurrency.integration.test.ts
 *
 * (Trust auth on purpose: the URL carries no password, so the secret scanner has
 * nothing to flag — its allowlist fingerprints are value+path bound and do not
 * transfer to new files. The guard below still requires a username.)
 */
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

// -----------------------------------------------------------------------------
// Guard — copied VERBATIM from
// `src/app/api/appointments/route.concurrency.integration.test.ts:38-68`.
//
// Copied verbatim on purpose: its `disposableDatabaseConfirmed` clause accepts
// the marker the `booking-entitlement-override-postgres` CI job already exports
// (`BOOKING_POLICY_ACKNOWLEDGMENT_DISPOSABLE_DATABASE_CONFIRMED`), so this file
// needs no new CI env var. Inventing a deposits-specific marker would make the
// suite silently skip in CI — the worst outcome for an opt-in test.
// -----------------------------------------------------------------------------
const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let parsedConcurrencyUrl: URL | null = null;
try {
  parsedConcurrencyUrl = RAW_URL ? new URL(RAW_URL) : null;
} catch {
  parsedConcurrencyUrl = null;
}
const parsedDatabaseName = parsedConcurrencyUrl
  ? decodeURIComponent(parsedConcurrencyUrl.pathname).replace(/^\//, '')
  : '';
const parsedDatabaseUser = parsedConcurrencyUrl
  ? decodeURIComponent(parsedConcurrencyUrl.username)
  : '';
const disposableDatabaseConfirmed
  = process.env.CLIENT_LIFECYCLE_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || process.env.BOOKING_POLICY_ACKNOWLEDGMENT_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || (
    parsedDatabaseName === 'luster_qa'
    && parsedConcurrencyUrl?.username === 'qa'
  );
const IS_LOCAL_THROWAWAY = parsedConcurrencyUrl != null
  && ['127.0.0.1', 'localhost'].includes(parsedConcurrencyUrl.hostname)
  && parsedDatabaseName.length > 0
  && parsedDatabaseUser.length > 0
  && disposableDatabaseConfirmed
  && !RAW_URL.includes('neon.tech');

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

const { ensureConnectedAccount } = await import('./binding');

const SALON = 'salon_conc_1';
const ACTOR = { actorId: 'admin_conc', viaSuperAdminWithoutMembership: false };

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

function accountPayload(id: string) {
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
  };
}

describe.skipIf(!IS_LOCAL_THROWAWAY)('test 32 — two concurrent binds for one salon', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: RAW_URL, max: 10 });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    holder.db = db;
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.delete(schema.salonStripeAccountSchema);
    await db.delete(schema.auditLogSchema);
    await db.delete(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));
    await db.insert(schema.salonSchema).values({ id: SALON, name: 'Conc', slug: 'conc-1' });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('produces exactly one live row, one orphan audit, and one answer for both callers', async () => {
    // Distinct ids on purpose: this is what two genuinely concurrent creates
    // look like. A blind `onConflictDoUpdate` would leave the two callers
    // holding DIFFERENT account ids, one of which is bound to nothing.
    //
    // The mock is also a BARRIER: neither create returns until both callers
    // have arrived. Without it, this test is flaky by construction — on a fast
    // runner the first bind can commit before the second call's initial
    // bindings read, which sends the second caller down the (correct, but
    // uncontended) resume path and the 23505 arm under test never executes.
    // `accounts.create` is only reached AFTER an empty bindings read, so two
    // arrivals prove both callers are inside the race window, and releasing
    // them together forces the INSERTs to actually contend.
    let arrivals = 0;
    let release!: () => void;
    const bothInCreateWindow = new Promise<void>((resolve) => {
      release = resolve;
    });
    stripeMock.accountsCreate.mockImplementation(async () => {
      arrivals += 1;
      const id = `acct_conc_${arrivals}`;
      if (arrivals === 2) {
        release();
      }
      await bothInCreateWindow;
      return accountPayload(id);
    });

    const [first, second] = await Promise.all([
      ensureConnectedAccount({ salonId: SALON, runtimeEnvironment: 'test', actor: ACTOR }),
      ensureConnectedAccount({ salonId: SALON, runtimeEnvironment: 'test', actor: ACTOR }),
    ]);

    // Both callers entered the create window — the barrier saw two arrivals.
    expect(stripeMock.accountsCreate).toHaveBeenCalledTimes(2);

    const rows = await db
      .select()
      .from(schema.salonStripeAccountSchema)
      .where(eq(schema.salonStripeAccountSchema.salonId, SALON));
    const live = rows.filter(row => row.revokedAt === null);

    expect(live).toHaveLength(1);

    // Both callers must be told about the SAME account — the surviving one.
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const firstId = first.ok ? first.binding.stripeAccountId : null;
    const secondId = second.ok ? second.binding.stripeAccountId : null;

    expect(firstId).toBe(secondId);
    expect(firstId).toBe(live[0]?.stripeAccountId);

    // The loser's account is real at Stripe and bound to nothing. It must be
    // recorded so it can be reconciled rather than left invisible.
    const audits = await db.select().from(schema.auditLogSchema);
    const orphans = audits.filter(row => row.action === 'stripe_connect_orphan_account');

    expect(orphans).toHaveLength(1);
  }, 60_000);
});
