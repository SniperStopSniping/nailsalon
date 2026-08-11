/**
 * D3 test 29c — the deposits entitlement: its protection on the organizations
 * PATCH and its ONE sanctioned writer, against real migrations.
 *
 * Protection and writer are ONE unit: protection without a writer leaves the key
 * with no way to be SET anywhere under `src/app/api`, so per-salon go-live and
 * the emergency kill switch both become direct production SQL.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEPOSITS_ENTITLEMENT_AUDIT_ACTION } from '@/libs/depositPolicy';
import * as schema from '@/models/Schema';
import type { SalonFeatures } from '@/types/salonPolicy';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const guard = vi.hoisted(() => ({
  ok: true,
  admin: { id: 'sa_1', email: 'super@luster.test' },
}));

vi.mock('@/libs/superAdmin', () => ({
  requireSuperAdminGuard: vi.fn(async () => (guard.ok
    ? { ok: true, admin: guard.admin }
    : { ok: false, response: new Response('forbidden', { status: 403 }) })),
}));

const { PATCH: ENTITLEMENT_PATCH } = await import('./entitlements/deposits/route');

const SALON = 'salon_entitlement_1';

type Db = ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let db: Db;

async function seed(features: unknown) {
  await db.delete(schema.salonAuditLogSchema);
  await db.delete(schema.salonSchema);
  await db
    .insert(schema.salonSchema)
    .values({ id: SALON, name: 'Entitlement Salon', slug: 'salon-entitlement-1' });
  await db
    .update(schema.salonSchema)
    .set({ features: features as never })
    .where(eq(schema.salonSchema.id, SALON));
}

async function features(): Promise<Record<string, any> | null> {
  const [row] = await db
    .select({ features: schema.salonSchema.features })
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, SALON));
  return row?.features as Record<string, any> | null;
}

function entitlementPatch(body: unknown) {
  return ENTITLEMENT_PATCH(
    new Request(`http://localhost/api/super-admin/organizations/${SALON}/entitlements/deposits`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: SALON }) },
  );
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  vi.clearAllMocks();
  guard.ok = true;
});

describe('test 29c — the sanctioned writer round-trips', () => {
  it('grants, is idempotent, and revokes', async () => {
    await seed({});

    const granted = await entitlementPatch({ entitled: true, expectedEntitled: false });

    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({ changed: true, entitled: true });
    expect((await features())?.money?.deposits).toBe(true);

    // A repeated call must not spam the audit log.
    const repeat = await entitlementPatch({ entitled: true, expectedEntitled: true });

    expect(await repeat.json()).toEqual({ changed: false, entitled: true });

    const revoked = await entitlementPatch({ entitled: false, expectedEntitled: true });

    expect(await revoked.json()).toEqual({ changed: true, entitled: false });
    expect((await features())?.money?.deposits).toBe(false);
  });

  it('preserves every unrelated feature key and a legacy scalar features column', async () => {
    await seed({ marketing: { rewards: true }, money: { staffEarnings: true } });

    await entitlementPatch({ entitled: true, expectedEntitled: false });

    expect(await features()).toEqual({
      marketing: { rewards: true },
      money: { staffEarnings: true, deposits: true },
    });
  });
});

describe('test 29c — the CAS', () => {
  it('refuses a stale expectation with a 409 carrying the current state', async () => {
    await seed({ money: { deposits: true } });

    const response = await entitlementPatch({ entitled: false, expectedEntitled: false });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'DEPOSITS_ENTITLEMENT_CONFLICT',
      current: { entitled: true },
    });
    expect((await features())?.money?.deposits).toBe(true);
  });
});

describe('test 29c case (g) — the row lock makes concurrency deterministic', () => {
  it('lets exactly ONE of two racing calls win', async () => {
    await seed({});

    const [first, second] = await Promise.all([
      entitlementPatch({ entitled: true, expectedEntitled: false }),
      entitlementPatch({ entitled: false, expectedEntitled: false }),
    ]);

    const statuses = [first.status, second.status].sort();

    // Without `select … for update` as the transaction's FIRST statement, both
    // read the old value, both pass the CAS, both write, and two audit rows
    // claim the same `previousValue` — a go-live can win over an emergency kill
    // on the route that IS the fastest kill switch.
    expect(statuses).toEqual([200, 409]);

    const audits = await db
      .select()
      .from(schema.salonAuditLogSchema)
      .where(eq(schema.salonAuditLogSchema.salonId, SALON));

    expect(audits.length).toBe(1);
  });
});

describe('test 29c case (g) — the lock is the transaction FIRST statement', () => {
  it('opens the transaction with select … for update, before the CAS read', () => {
    // PGlite is single-connection, so the behavioural case above cannot force a
    // true interleaving; this pins the mechanism the charter requires. Without
    // it two concurrent calls both read the old value, both pass the CAS, both
    // write, and two audit rows claim the same `previousValue`.
    const source = readFileSync(
      path.join(
        process.cwd(),
        'src/app/api/super-admin/organizations/[id]/entitlements/deposits/route.ts',
      ),
      'utf8',
    );
    const body = source.split('db.transaction<MutationResult>(async (tx) => {')[1]!;
    const lockAt = body.indexOf('for update');
    const casReadAt = body.indexOf('resolveDepositEntitlement(');

    expect(lockAt).toBeGreaterThan(-1);
    expect(casReadAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(casReadAt);
    // No statement precedes the lock inside the transaction.
    expect(body.slice(0, lockAt)).not.toContain('await tx.select');
  });
});

describe('test 29c — the transactional audit row', () => {
  it('records the action, the actor and both values in the SAME transaction', async () => {
    await seed({});

    await entitlementPatch({ entitled: true, expectedEntitled: false, reason: 'pilot go-live' });

    const [audit] = await db
      .select()
      .from(schema.salonAuditLogSchema)
      .where(eq(schema.salonAuditLogSchema.salonId, SALON));

    expect(audit?.action).toBe(DEPOSITS_ENTITLEMENT_AUDIT_ACTION);
    expect(audit?.performedBy).toBe('sa_1');
    expect(audit?.performedByEmail).toBe('super@luster.test');
    expect(audit?.metadata).toMatchObject({
      field: 'money_deposits',
      previousValue: false,
      newValue: true,
    });
    expect((audit?.metadata as { details?: string })?.details).toContain('pilot go-live');
  });

  it('leaves NO audit row behind when the CAS refuses', async () => {
    await seed({ money: { deposits: true } });

    await entitlementPatch({ entitled: false, expectedEntitled: false });

    const audits = await db
      .select()
      .from(schema.salonAuditLogSchema)
      .where(eq(schema.salonAuditLogSchema.salonId, SALON));

    expect(audits.length).toBe(0);
  });
});

describe('test 29c — the guard', () => {
  it('is requireSuperAdminGuard, never requireAdmin', async () => {
    await seed({});
    guard.ok = false;

    const response = await entitlementPatch({ entitled: true, expectedEntitled: false });

    expect(response.status).toBe(403);
    expect((await features())?.money?.deposits).toBeUndefined();
  });
});

describe('test 29c — the organizations PATCH protects the key in BOTH directions', () => {
  it('DISCARDS a requested value and RESTORES the live one, grouped and legacy', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/app/api/super-admin/organizations/[id]/route.ts'),
      'utf8',
    );

    // The mechanism does not REJECT a stale value; it strips the requested one
    // and restores the live one, so the key becomes immutable through this route
    // in BOTH directions — which is exactly why the dedicated writer above is
    // mandatory rather than optional.
    expect(source).toContain('function protectFeatureOverrides(');
    expect(source).toContain('protectFeatureOverrides(');
    expect(source).not.toContain('protectBookingExperienceOverride');

    const protector = source
      .split('function protectFeatureOverrides(')[1]!
      .split('\nexport ')[0]!;

    // The GROUPED key must actually be written back into the returned
    // expression — stripping and rebuilding it but never splicing it into
    // `{money}` protects nothing.
    expect(protector).toContain(`'{money}'`);
    expect(protector).toContain(`? 'deposits'`);
    expect(protector).toContain(`'{deposits}'`);
    // …and the LEGACY flat key, which `resolveEntitlement` honours as its
    // second branch, so protecting only the grouped one leaves a path open.
    expect(protector).toContain(`- 'deposits'`);
    expect(protector.match(/- 'deposits'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('case (h) — the onboarding claim can only REMOVE the key, never set it', async () => {
    // Documented, not exercised through the route: `onboarding/luster` writes a
    // fixed literal and is unreachable for a salon with any appointment or admin
    // membership, so it cannot grant this entitlement.
    await seed({ money: { deposits: true } });

    await db
      .update(schema.salonSchema)
      .set({ features: { booking: { onlineBooking: true } } as never })
      .where(eq(schema.salonSchema.id, SALON));

    expect((await features())?.money?.deposits).toBeUndefined();

    const regranted = await entitlementPatch({ entitled: true, expectedEntitled: false });

    expect(regranted.status).toBe(200);
    expect((await features())?.money?.deposits).toBe(true);
  });
});

describe('test 29c — the protected key resolves through both entitlement branches', () => {
  it('honours the grouped key and the legacy flat key', async () => {
    const { resolveDepositEntitlement } = await import('@/libs/depositPolicy');

    expect(resolveDepositEntitlement({ money: { deposits: true } } as SalonFeatures)).toBe(true);
    expect(resolveDepositEntitlement({ deposits: true } as unknown as SalonFeatures)).toBe(true);
    expect(resolveDepositEntitlement({} as SalonFeatures)).toBe(false);
    expect(resolveDepositEntitlement(null)).toBe(false);
  });
});
