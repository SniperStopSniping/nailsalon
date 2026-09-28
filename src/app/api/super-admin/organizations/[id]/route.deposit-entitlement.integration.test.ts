import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEPOSITS_ENTITLEMENT_AUDIT_ACTION } from '@/libs/depositPolicy';
import * as schema from '@/models/Schema';

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

const { PATCH: entitlementPatch } = await import('./entitlements/deposits/route');

const salonId = 'salon_entitlement_1';
type Db = ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let db: Db;

async function seed(features: unknown) {
  await db.delete(schema.salonAuditLogSchema);
  await db.delete(schema.salonSchema);
  await db.insert(schema.salonSchema).values({
    id: salonId,
    name: 'Entitlement Salon',
    slug: 'salon-entitlement-1',
    features: features as never,
  });
}

function patch(body: unknown) {
  return entitlementPatch(
    new Request(`http://localhost/api/super-admin/organizations/${salonId}/entitlements/deposits`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: salonId }) },
  );
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

beforeEach(() => {
  guard.ok = true;
});

afterAll(async () => {
  await client.close();
});

describe('deposit emergency suspension', () => {
  it('suspends and resumes effective deposit availability without forging legacy activation evidence', async () => {
    await seed({ money: { deposits: true } });

    const suspended = await patch({ entitled: false, expectedEntitled: true, reason: 'payment incident' });

    expect(suspended.status).toBe(200);
    expect(await suspended.json()).toEqual({ changed: true, entitled: false });

    const [afterSuspend] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));

    expect(afterSuspend?.features?.money).toMatchObject({ deposits: true, depositsSuspended: true });

    const resumed = await patch({ entitled: true, expectedEntitled: false });

    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toEqual({ changed: true, entitled: true });

    const [afterResume] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));

    expect(afterResume?.features?.money).toMatchObject({ deposits: true, depositsSuspended: false });
  });

  it('does not create historical activation evidence while resuming a dormant universal setup', async () => {
    await seed({ money: { depositsSuspended: true } });

    const response = await patch({ entitled: true, expectedEntitled: false });

    expect(response.status).toBe(200);

    const [salon] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));

    expect(salon?.features?.money).toEqual({ depositsSuspended: false });
  });

  it('uses a locked compare-and-set and audit row', async () => {
    await seed({});

    const stale = await patch({ entitled: false, expectedEntitled: false });

    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: 'DEPOSITS_ENTITLEMENT_CONFLICT',
      current: { entitled: true },
    });

    const suspended = await patch({ entitled: false, expectedEntitled: true });

    expect(suspended.status).toBe(200);

    const [audit] = await db.select().from(schema.salonAuditLogSchema)
      .where(eq(schema.salonAuditLogSchema.salonId, salonId));

    expect(audit?.action).toBe(DEPOSITS_ENTITLEMENT_AUDIT_ACTION);
    expect(audit?.metadata).toMatchObject({
      field: 'money_deposits_suspended',
      previousValue: false,
      newValue: true,
    });
  });

  it('requires the super-admin guard', async () => {
    await seed({});
    guard.ok = false;

    expect((await patch({ entitled: false, expectedEntitled: true })).status).toBe(403);
  });
});
