import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
const guard = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin: guard.requireSuperAdmin }));

const { GET, POST } = await import('./route');

let db: ReturnType<typeof drizzle<typeof schema>>;
const SUPER_ADMIN = { ok: true as const, admin: { id: 'super_credits_1' } };

function post(salonId: string, body: unknown) {
  return POST(new Request(`http://localhost/api/super-admin/salons/${salonId}/sms-credits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: salonId }) });
}

function get(salonId: string) {
  return GET(new Request(`http://localhost/api/super-admin/salons/${salonId}/sms-credits`), {
    params: Promise.resolve({ id: salonId }),
  });
}

async function seedSalon(id: string, deletedAt: Date | null = null) {
  await db.insert(schema.salonSchema).values({ id, name: `Salon ${id}`, slug: id, deletedAt });
}

beforeAll(async () => {
  const client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  vi.clearAllMocks();
  guard.requireSuperAdmin.mockResolvedValue(SUPER_ADMIN);
});

describe('super-admin SMS credits', () => {
  it('denies unauthenticated calls before touching the target salon', async () => {
    await seedSalon('route-credit-denied');
    guard.requireSuperAdmin.mockResolvedValue({ ok: false, response: new Response('Unauthorized', { status: 401 }) });

    const response = await post('route-credit-denied', {
      amount: 10,
      reason: 'Support',
      idempotencyKey: '7f4e5302-ab84-4cff-995b-a79725d3a61a',
    });

    expect(response.status).toBe(401);
    expect(await db.select().from(schema.smsCreditLedgerSchema)).toHaveLength(0);
  });

  it('adds exactly one lot and one atomic audit row when the request is retried', async () => {
    await seedSalon('route-credit-replay');
    const body = { amount: 40, reason: 'Service recovery', idempotencyKey: '50d253db-7f30-416e-9eba-99e55d9f7fe1' };

    const first = await post('route-credit-replay', body);
    const replay = await post('route-credit-replay', body);
    const result = await first.json();
    const replayResult = await replay.json();

    expect(first.status).toBe(200);
    expect(result).toMatchObject({ created: true, balance: 40, administrativeBalance: 40 });
    expect(replayResult).toMatchObject({ created: false, lotId: result.lotId, balance: 40 });
    expect(await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 'route-credit-replay'))).toHaveLength(1);

    const audit = await db.select().from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.salonId, 'route-credit-replay'));

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'sms_credits_administered', actorType: 'super_admin', entityType: 'sms_credit_administrative_grant' });
  });

  it('rejects idempotency-key reuse for another salon and does not leak a target balance', async () => {
    await seedSalon('route-credit-source');
    await seedSalon('route-credit-other');
    const idempotencyKey = '8fbd6d91-2044-40e7-8544-c336749da74a';
    await post('route-credit-source', { amount: 9, reason: 'Support', idempotencyKey });

    const conflict = await post('route-credit-other', { amount: 9, reason: 'Support', idempotencyKey });
    const otherBalance = await get('route-credit-other');

    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await otherBalance.json()).toEqual({ balance: 0, administrativeBalance: 0 });
    expect(await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 'route-credit-other'))).toHaveLength(0);
  });

  it('does not grant to a deleted salon', async () => {
    await seedSalon('route-credit-deleted', new Date());
    const response = await post('route-credit-deleted', {
      amount: 10,
      reason: 'Support',
      idempotencyKey: '1810779b-3076-4b62-893a-63019e490f7a',
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('SALON_DELETED');
  });
});

it.each([
  { origin: 'https://other.example', contentType: 'application/json', expected: 403 },
  { origin: 'http://localhost', contentType: 'text/plain', expected: 415 },
])('rejects unsafe credit mutation requests before any grant ($expected)', async ({ origin, contentType, expected }) => {
  const response = await POST(new Request('http://localhost/api/super-admin/salons/no-mutation/sms-credits', {
    method: 'POST',
    headers: { origin, 'content-type': contentType },
    body: JSON.stringify({ amount: 10, reason: 'Cross-origin attempt', idempotencyKey: '7f4e5302-ab84-4cff-995b-a79725d3a61a' }),
  }), { params: Promise.resolve({ id: 'no-mutation' }) });

  expect(response.status).toBe(expected);
  expect(await db.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, 'no-mutation'))).toEqual([]);
});
