import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', () => ({ Env: {} }));
const mocks = vi.hoisted(() => ({ guard: vi.fn(), renewals: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin: mocks.guard }));
vi.mock('@/libs/billing/subscriptionRenewalTransition', () => ({ transitionSalonSubscriptionRenewals: mocks.renewals }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: () => ({ allowed: true }), getClientIp: () => '127.0.0.1', rateLimitResponse: vi.fn() }));
const { GET, POST } = await import('./route');
let db: ReturnType<typeof drizzle<typeof schema>>;
let counter = 0;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, admin: { id: 'super_admin' } });
  mocks.renewals.mockResolvedValue([]);
});

async function salon() {
  const id = `transition_${++counter}`;
  await db.insert(schema.salonSchema).values({ id, name: id, slug: id });
  return id;
}
function post(body: Record<string, unknown>) {
  return POST(new Request('https://app.test/api/super-admin/billing/free-model-transition', { method: 'POST', body: JSON.stringify(body) }));
}

describe('auditable free model rollout', () => {
  it('requires super-admin authorization before inventory or mutation', async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });

    expect((await GET()).status).toBe(403);
    expect((await post({ mode: 'apply' })).status).toBe(403);
    expect(mocks.renewals).not.toHaveBeenCalled();
  });

  it('inventories missing accounts without creating them', async () => {
    const id = await salon();
    const result = await (await GET()).json();

    expect(result.salons.find((item: { id: string }) => item.id === id)).toMatchObject({ account_exists: false, starter_claimed: false, has_subscription: false });
    expect(await db.select().from(schema.smsCreditAccountSchema)).toEqual([]);
  });

  it('requires a matching confirmation before touching Stripe', async () => {
    const id = await salon();

    expect((await post({ salonSlug: id, mode: 'apply', confirmation: 'other' })).status).toBe(400);
    expect(mocks.renewals).not.toHaveBeenCalled();
  });

  it('rehearses without writes and reports the starter verification hold', async () => {
    const id = await salon();
    const result = await (await post({ salonSlug: id, mode: 'plan' })).json();

    expect(result.starter).toMatchObject({ wouldGrant: false, heldReason: 'IDENTITY_SETUP_REQUIRED' });
    expect(mocks.renewals).toHaveBeenCalledWith(id, 'super_admin', false);
    expect(await db.select().from(schema.smsCreditAccountSchema)).toEqual([]);
  });

  it('initializes missing accounts repeatedly without granting an unverified bonus', async () => {
    const id = await salon();
    for (let i = 0; i < 2; i++) {
      const result = await (await post({ salonSlug: id, mode: 'apply', confirmation: id })).json();

      expect(result.starter).toMatchObject({ granted: false, heldReason: 'IDENTITY_SETUP_REQUIRED' });
    }

    expect(await db.select().from(schema.smsCreditAccountSchema)).toMatchObject([{ salonId: id, cachedAvailable: 0 }]);
    expect(await db.select().from(schema.smsCreditLedgerSchema)).toEqual([]);
    expect(await db.select().from(schema.billingStarterGrantSchema)).toEqual([]);
    expect(await db.select().from(schema.auditLogSchema)).toHaveLength(2);
  });
});
