/**
 * D3 deposits — Vitest + PGlite against the REAL migrations, including 0065.
 *
 * These cases exist because the mocked-db suite can only see WHICH path literals
 * the generated expression contains. Everything here turns on what the emitted
 * SQL actually DOES to the column when a concurrent writer got there first.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const mocks = vi.hoisted(() => ({
  getSalonBySlug: vi.fn(),
  getSalonById: vi.fn(async () => null),
  refreshAccountReadiness: vi.fn(),
  logAuditEvent: vi.fn(async (_entry: { metadata: { after: Record<string, any> } }) => {}),
  getModulesSalon: vi.fn(async () => null as unknown),
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, admin: { id: 'admin_1' } })),
  requireAdminSalon: vi.fn(async () => ({ error: null, salon: await mocks.getModulesSalon() })),
}));

vi.mock('@/libs/auditLog', () => ({ logAuditEvent: mocks.logAuditEvent }));

// `getSalonById` is reached through `getBookingConfigForSalon`'s dynamic import
// at the tail of the PATCH, and through the policy reader when no salon is passed.
vi.mock('@/libs/queries', () => ({
  getSalonBySlug: mocks.getSalonBySlug,
  getSalonById: mocks.getSalonById,
}));

vi.mock('@/libs/stripeConnect/readiness', () => ({
  refreshAccountReadiness: mocks.refreshAccountReadiness,
}));

const { PATCH } = await import('./route');
const { PUT: MODULES_PUT } = await import('@/app/api/admin/settings/modules/route');
const { getDepositPolicyForSalon } = await import('@/libs/depositPolicy.server');

const SALON = 'salon_deposit_1';
const OTHER = 'salon_deposit_2';

type Db = ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let db: Db;

async function seedSalon(id: string, settings: unknown, features: unknown = { money: { deposits: true } }) {
  await db
    .insert(schema.salonSchema)
    .values({ id, name: 'Deposit Salon', slug: id.replace(/_/g, '-') })
    .onConflictDoNothing();
  await db
    .update(schema.salonSchema)
    .set({ settings: settings as SalonSettings, features: features as never })
    .where(eq(schema.salonSchema.id, id));
}

async function readSettings(id = SALON) {
  const [row] = await db
    .select({ settings: schema.salonSchema.settings })
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, id));
  return row?.settings as Record<string, any> | null;
}

/**
 * `slug` is resolved through the mocked `getSalonBySlug`, so the snapshot it
 *  returns is exactly the request-start view a stale tab would have had.
 */
function patchWith(snapshot: unknown, body: unknown, slug = SALON.replace(/_/g, '-')) {
  mocks.getSalonBySlug.mockResolvedValueOnce(snapshot);
  return PATCH(
    new Request(`http://localhost/api/admin/salon/settings?salonSlug=${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function currentSnapshot(id = SALON) {
  const [row] = await db
    .select()
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, id));
  return row;
}

const CHARGE_READY = {
  chargeReady: true as const,
  status: 'charge_ready' as const,
  payoutsPending: false,
  binding: {
    id: 'ssa_1',
    salonId: SALON,
    stripeAccountId: 'acct_1',
    livemode: false,
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
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
    lastSyncedAt: new Date(),
  },
};

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  // A migration failure at or above 0065 is a schema defect, not a test problem.
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.logAuditEvent.mockResolvedValue(undefined);
  mocks.refreshAccountReadiness.mockResolvedValue(CHARGE_READY);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonSchema);
});

// =============================================================================
// 25 / 25e — the gate and the read-time policy against a real binding row
// =============================================================================

describe('test 25 — the enable gate and the local read-time policy', () => {
  it('refuses while the account is not charge-ready and succeeds once it is', async () => {
    await seedSalon(SALON, {});
    await db.insert(schema.salonStripeAccountSchema).values({
      id: 'ssa_1',
      salonId: SALON,
      stripeAccountId: 'acct_1',
      livemode: false,
      chargesEnabled: false,
      lastSyncedAt: new Date(),
    });
    mocks.refreshAccountReadiness.mockResolvedValue({
      chargeReady: false,
      status: 'restricted',
      binding: { ...CHARGE_READY.binding, chargesEnabled: false },
    });

    const refused = await patchWith(
      await currentSnapshot(),
      { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    );

    expect(refused.status).toBe(409);
    expect((await readSettings())?.payments?.deposit?.enabled).toBeUndefined();

    await db
      .update(schema.salonStripeAccountSchema)
      .set({ chargesEnabled: true })
      .where(eq(schema.salonStripeAccountSchema.id, 'ssa_1'));
    mocks.refreshAccountReadiness.mockResolvedValue(CHARGE_READY);

    const enabled = await patchWith(
      await currentSnapshot(),
      { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    );

    expect(enabled.status).toBe(200);
    expect((await readSettings())?.payments?.deposit).toEqual({
      enabled: true,
      amountCents: 2500,
    });

    // The read path reads the row LOCALLY and takes no provider proof.
    mocks.refreshAccountReadiness.mockClear();
    const salon = await currentSnapshot();
    const policy = await getDepositPolicyForSalon({
      salonId: SALON,
      salon,
      collectionLive: true,
      entitled: true,
    });

    expect(policy.active).toBe(true);
    expect(mocks.refreshAccountReadiness).not.toHaveBeenCalled();

    expect((await getDepositPolicyForSalon({
      salonId: SALON,
      salon,
      collectionLive: false,
      entitled: true,
    })).active).toBe(false);
    expect((await getDepositPolicyForSalon({
      salonId: SALON,
      salon,
      collectionLive: true,
      entitled: false,
    })).active).toBe(false);
  });
});

describe('test 25e — the policy RE-ARMS on rebind', () => {
  it('goes inactive on revocation and active again on a fresh charge-ready binding', async () => {
    await seedSalon(SALON, { payments: { deposit: { enabled: true, amountCents: 2500 } } });
    await db.insert(schema.salonStripeAccountSchema).values({
      id: 'ssa_old',
      salonId: SALON,
      stripeAccountId: 'acct_old',
      livemode: false,
      chargesEnabled: true,
      lastSyncedAt: new Date(),
      revokedAt: new Date(),
      revocationCause: 'revoked_local',
    });

    const salon = await currentSnapshot();

    expect(await getDepositPolicyForSalon({
      salonId: SALON,
      salon,
      collectionLive: true,
      entitled: true,
    })).toMatchObject({ active: false, reason: 'account_not_connected' });

    await db.insert(schema.salonStripeAccountSchema).values({
      id: 'ssa_new',
      salonId: SALON,
      stripeAccountId: 'acct_new',
      livemode: false,
      chargesEnabled: true,
      lastSyncedAt: new Date(),
    });

    expect((await getDepositPolicyForSalon({
      salonId: SALON,
      salon,
      collectionLive: true,
      entitled: true,
    })).active).toBe(true);
  });
});

// =============================================================================
// 25b / 25c / 25d / 25f — lost updates, monotonicity, and the CAS
// =============================================================================

describe('test 25b — deposit-vs-deposit lost update', () => {
  it('an amount edit from a stale snapshot cannot resurrect a committed disable', async () => {
    await seedSalon(SALON, { payments: { deposit: { enabled: true, amountCents: 2500 } } });
    const staleSnapshot = await currentSnapshot();

    const disabled = await patchWith(
      await currentSnapshot(),
      { payments: { deposit: { enabled: false } } },
    );

    expect(disabled.status).toBe(200);

    const amountEdit = await patchWith(
      staleSnapshot,
      { payments: { deposit: { amountCents: 4000 } } },
    );

    expect(amountEdit.status).toBe(200);
    expect((await readSettings())?.payments?.deposit).toEqual({
      enabled: false,
      amountCents: 4000,
    });
  });
});

describe('test 25c — the disable survives a stale tab that re-posts enabled:true', () => {
  it('keeps the persisted value false and audits what was PERSISTED', async () => {
    await seedSalon(SALON, { payments: { deposit: { enabled: true, amountCents: 2500 } } });
    const staleSnapshot = await currentSnapshot();

    await patchWith(await currentSnapshot(), { payments: { deposit: { enabled: false } } });
    mocks.logAuditEvent.mockClear();

    // The Deposits card's natural save body, from a tab opened before the disable.
    const response = await patchWith(
      staleSnapshot,
      { payments: { deposit: { enabled: true, amountCents: 4000 } } },
    );

    expect(response.status).toBe(200);
    expect((await readSettings())?.payments?.deposit).toEqual({
      enabled: false,
      amountCents: 4000,
    });

    const auditArg = mocks.logAuditEvent.mock.calls.at(-1)![0];

    // Without the persisted-value re-derivation the audit row would assert a
    // re-enable the database refused — on the one setting that moves money.
    expect(auditArg.metadata.after.payments.deposit.enabled).toBe(false);
    expect(auditArg.metadata.after.depositEnableSuppressed).toBe(true);
  });
});

describe('test 25d — the FIRST-ENABLE case', () => {
  it('(a) a salon that never stored a deposit block enables 200, not 409', async () => {
    // If the absent path were emitted as the quoted `'null'::jsonb`, the
    // predicate would be false for exactly the state every salon is in before
    // its first enable — a permanent 409 after a live, billed Stripe read.
    await seedSalon(SALON, { payments: { etransfer: { recipient: 'pay@salon.test' } } });

    const response = await patchWith(
      await currentSnapshot(),
      { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    );

    expect(response.status).toBe(200);

    const settings = await readSettings();

    expect(settings?.payments?.deposit).toEqual({ enabled: true, amountCents: 2500 });
    // After EVERY deposit write: a non-null object, and the untouched sibling
    // byte-identical.
    expect(settings).toBeTypeOf('object');
    expect(settings).not.toBeNull();
    expect(settings?.payments?.etransfer?.recipient).toBe('pay@salon.test');
  });

  it('(b) a CAS that is always false would 409 the same request', async () => {
    // Run with (a): (a) alone is satisfied by deleting the CAS entirely, and (b)
    // alone is satisfied by a predicate that is always false.
    await seedSalon(SALON, { payments: { deposit: { enabled: true, amountCents: 2500 } } });
    const staleSnapshot = await currentSnapshot();

    await patchWith(await currentSnapshot(), { payments: { deposit: { enabled: false } } });

    const conflicted = await patchWith(
      staleSnapshot,
      { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    );

    // The stale enable ran the gate (stored `false` at request start was `true`
    // in the snapshot... so no transition) — the monotonic write keeps it false.
    expect((await readSettings())?.payments?.deposit?.enabled).toBe(false);
    expect(conflicted.status).toBe(200);

    // Now a genuine transition whose snapshot has since moved: the CAS fires.
    const nowFalse = await currentSnapshot();
    await db
      .update(schema.salonSchema)
      .set({
        settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } } as SalonSettings,
      })
      .where(eq(schema.salonSchema.id, SALON));

    const casConflict = await patchWith(
      nowFalse,
      { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    );

    expect(casConflict.status).toBe(409);
    expect((await casConflict.json()).error).toBe('DEPOSIT_STATE_CHANGED');
  });
});

describe('test 25f — amountCents is last-write-wins, documented not closed', () => {
  it('lets the later ungated amount edit win', async () => {
    await seedSalon(SALON, { payments: { deposit: { enabled: false, amountCents: 2500 } } });
    const snapshot = await currentSnapshot();

    await patchWith(snapshot, { payments: { deposit: { amountCents: 3000 } } });
    await patchWith(snapshot, { payments: { deposit: { amountCents: 4000 } } });

    expect((await readSettings())?.payments?.deposit?.amountCents).toBe(4000);
  });
});

// =============================================================================
// 26 / 26b / 26c / 26d — cross-writer lost updates, in BOTH commit orders
// =============================================================================

describe('test 26 / 26b — tax and deposit cannot revert one another', () => {
  it('a tax save does not revert a committed deposit save', async () => {
    await seedSalon(SALON, { payments: { tax: { rateBps: 1300 } } });
    const staleSnapshot = await currentSnapshot();

    await patchWith(await currentSnapshot(), { payments: { deposit: { amountCents: 4000 } } });
    await patchWith(staleSnapshot, { payments: { tax: { rateBps: 500 } } });

    const settings = await readSettings();

    expect(settings?.payments?.deposit?.amountCents).toBe(4000);
    expect(settings?.payments?.tax?.rateBps).toBe(500);
  });

  it('a deposit save does not revert a committed tax save', async () => {
    await seedSalon(SALON, { payments: { tax: { rateBps: 1300 } } });
    const staleSnapshot = await currentSnapshot();

    await patchWith(await currentSnapshot(), { payments: { tax: { rateBps: 500 } } });
    await patchWith(staleSnapshot, { payments: { deposit: { amountCents: 4000 } } });

    const settings = await readSettings();

    expect(settings?.payments?.tax?.rateBps).toBe(500);
    expect(settings?.payments?.deposit?.amountCents).toBe(4000);
  });
});

describe('test 26c / 26d — deposit save vs service-image save, BOTH commit orders', () => {
  const SEED = {
    merchandising: { showServiceImages: true, futurePreference: 'keep' },
    payments: {
      tax: { rateBps: 1300 },
      deposit: { enabled: true, amountCents: 2500 },
    },
  };

  it('26c — order A: image first, deposit second, from the pre-image snapshot', async () => {
    await seedSalon(SALON, SEED);
    const S = await currentSnapshot();

    await patchWith(await currentSnapshot(), { merchandising: { showServiceImages: false } });
    await patchWith(S, { payments: { deposit: { amountCents: 4000 } } });

    const settings = await readSettings();

    // Red against any whole-key `{merchandising}` write in the deposit chain, or
    // a restored whole-`{payments}` write built from S.
    expect(settings?.merchandising?.showServiceImages).toBe(false);
    expect(settings?.merchandising?.futurePreference).toBe('keep');
    expect(settings?.payments?.deposit?.amountCents).toBe(4000);
    expect(settings?.payments?.deposit?.enabled).toBe(true);
    expect(settings?.payments?.tax?.rateBps).toBe(1300);
  });

  it('26d — order B: deposit first, image second, from the pre-deposit snapshot', async () => {
    // NOT implied by 26c. 26c runs the deposit expression against a
    // merchandising-modified row; 26d runs the UNTOUCHED merchandising
    // expression against a deposit-modified row, which is the only order that
    // exposes a change to the SHARED part of the builder.
    await seedSalon(SALON, SEED);
    const S = await currentSnapshot();

    await patchWith(await currentSnapshot(), { payments: { deposit: { amountCents: 4000 } } });
    await patchWith(S, { merchandising: { showServiceImages: false } });

    const settings = await readSettings();

    expect(settings?.payments?.deposit?.amountCents).toBe(4000);
    expect(settings?.payments?.deposit?.enabled).toBe(true);
    expect(settings?.payments?.tax?.rateBps).toBe(1300);
    expect(settings?.merchandising?.showServiceImages).toBe(false);
    expect(settings?.merchandising?.futurePreference).toBe('keep');
    expect(settings).toBeTypeOf('object');
    expect(settings).not.toBeNull();
  });
});

// =============================================================================
// 27 / 28 — namespace collapse and the modules route
// =============================================================================

describe('test 27 — a malformed sibling must not collapse the deposit block', () => {
  it('keeps the deposit block readable beside a legacy tax value', async () => {
    await seedSalon(SALON, {
      payments: {
        tax: 'legacy-string',
        deposit: { enabled: true, amountCents: 2500 },
      },
    });

    const { readStoredPaymentsSettings } = await import('@/libs/taxConfig');
    const stored = readStoredPaymentsSettings(await readSettings() as SalonSettings);

    expect(stored.deposit).toEqual({ enabled: true, amountCents: 2500 });
    expect(stored.tax).toBeUndefined();
  });
});

describe('test 28 — the modules route no longer clobbers the deposit block', () => {
  it('preserves a CONCURRENTLY written payments.deposit and derives its response from the persisted row', async () => {
    await seedSalon(SALON, {
      modules: { smsReminders: false },
    }, { marketing: { smsReminders: true } });

    // The modules handler resolves its own salon at request start. Hand it a
    // snapshot taken BEFORE the deposit save: the whole-object read-modify-write
    // this route used to do would replay that snapshot and erase the deposit.
    const staleSnapshot = await currentSnapshot();

    await patchWith(
      await currentSnapshot(),
      { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    );

    expect((await readSettings())?.payments?.deposit?.amountCents).toBe(2500);

    mocks.getModulesSalon.mockResolvedValue(staleSnapshot);

    const response = await MODULES_PUT(
      new Request('http://localhost/api/admin/settings/modules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: SALON.replace(/_/g, '-'),
          modules: { smsReminders: true },
        }),
      }) as never,
    );

    expect(response.status).toBe(200);

    const settings = await readSettings();

    expect(settings?.payments?.deposit).toEqual({ enabled: true, amountCents: 2500 });
    expect(settings?.modules?.smsReminders).toBe(true);
  });
});

// =============================================================================
// 23c — the settings GET drives the REAL resolver
// =============================================================================

describe('test 23c — the GET forces BOTH launch gates on', () => {
  it('reports the diagnostic reason rather than a launch gate', async () => {
    // 23 and 23b both mock the thing under test, so neither can detect a GET
    // that passes no overrides. This one drives the real resolver.
    await seedSalon(SALON, { payments: { deposit: { enabled: true, amountCents: 2500 } } });

    const policy = await getDepositPolicyForSalon({
      salonId: SALON,
      salon: await currentSnapshot(),
      collectionLive: true,
      entitled: true,
    });

    expect(policy).toMatchObject({ active: false, reason: 'account_not_connected' });
    expect(policy).not.toMatchObject({ reason: 'collection_not_live' });
    expect(policy).not.toMatchObject({ reason: 'not_entitled' });
  });
});

// =============================================================================
// 29 / 29b / 29d — entitlement resolution against real rows
// =============================================================================

describe('test 29 / 29b — entitlement is per salon and honours all three branches', () => {
  it('separates two enabled salons by entitlement alone', async () => {
    await seedSalon(SALON, { payments: { deposit: { enabled: true, amountCents: 2500 } } }, {
      money: { deposits: true },
    });
    await seedSalon(OTHER, { payments: { deposit: { enabled: true, amountCents: 2500 } } }, {});

    const entitled = await getDepositPolicyForSalon({
      salonId: SALON,
      salon: await currentSnapshot(SALON),
      collectionLive: true,
    });
    const notEntitled = await getDepositPolicyForSalon({
      salonId: OTHER,
      salon: await currentSnapshot(OTHER),
      collectionLive: true,
    });

    expect(entitled).not.toMatchObject({ reason: 'not_entitled' });
    expect(notEntitled).toMatchObject({ active: false, reason: 'not_entitled' });
  });

  it('honours the LEGACY flat key as the second branch', async () => {
    await seedSalon(SALON, { payments: { deposit: { enabled: true, amountCents: 2500 } } }, {
      deposits: true,
    });

    const policy = await getDepositPolicyForSalon({
      salonId: SALON,
      salon: await currentSnapshot(SALON),
      collectionLive: true,
    });

    expect(policy).not.toMatchObject({ reason: 'not_entitled' });
  });

  it('defaults to FALSE when neither key is present', async () => {
    await seedSalon(SALON, { payments: { deposit: { enabled: true, amountCents: 2500 } } }, null);

    expect(await getDepositPolicyForSalon({
      salonId: SALON,
      salon: await currentSnapshot(SALON),
      collectionLive: true,
    })).toMatchObject({ active: false, reason: 'not_entitled' });
  });
});

describe('test 29d — no fixture salon ships entitled', () => {
  it('leaves features.money.deposits unset on a freshly inserted salon', async () => {
    await db
      .insert(schema.salonSchema)
      .values({ id: 'salon_fresh', name: 'Fresh', slug: 'salon-fresh' });

    const [row] = await db
      .select({ features: schema.salonSchema.features })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, 'salon_fresh'));

    expect((row?.features as Record<string, any> | null)?.money?.deposits).toBeUndefined();
  });
});
