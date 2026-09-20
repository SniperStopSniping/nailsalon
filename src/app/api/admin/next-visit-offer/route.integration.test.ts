import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { GET, PATCH } from './route';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown, salon: null as unknown, audit: vi.fn() }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock('@/libs/adminAuth', () => ({
  getAdminSession: vi.fn(async () => ({ id: 'admin' })),
  requireAdminSalon: vi.fn(async () => holder.salon),
}));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: holder.audit }));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function settings(enabled: boolean, eligibleServiceIds: string[] = []) {
  return { enabled, windowDays: 30, discountType: 'percent' as const, value: 10, eligibleServiceIds, messageTemplate: 'Next visit' };
}
function request(method: 'GET' | 'PATCH', salonSlug: string, payload?: unknown) {
  return new Request(`http://x/api?salonSlug=${salonSlug}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await db.insert(schema.salonSchema).values([{ id: 's1', name: 'One', slug: 'one' }, { id: 's2', name: 'Two', slug: 'two' }]);
  await db.insert(schema.serviceSchema).values([
    { id: 'a', salonId: 's1', name: 'A', category: 'manicure', price: 4000, durationMinutes: 60 },
    { id: 'b', salonId: 's2', name: 'B', category: 'manicure', price: 4000, durationMinutes: 60 },
  ]);
}, 60_000);

beforeEach(async () => {
  await db.delete(schema.salonRetentionSettingsSchema);
  holder.salon = { salon: { id: 's1', slug: 'one' } };
  vi.clearAllMocks();
});

afterAll(async () => {
  await client.close();
});

describe('next visit owner settings integration', () => {
  it('defaults off and preserves review settings through enablement edits', async () => {
    await db.insert(schema.salonRetentionSettingsSchema).values({ salonId: 's1', automaticReviewRequests: true, reviewRequestDelayMinutes: 90 });
    const initial = await GET(request('GET', 'one'));

    expect((await initial.json()).data.settings).toMatchObject({ enabled: false, windowDays: 30, value: 5 });

    const enabled = await PATCH(request('PATCH', 'one', settings(true, ['a'])));

    expect(enabled.status).toBe(200);

    let row = (await db.select().from(schema.salonRetentionSettingsSchema))[0]!;

    expect(row.nextVisitOfferEnabledAt).toBeTruthy();
    expect(row.automaticReviewRequests).toBe(true);
    expect(row.reviewRequestDelayMinutes).toBe(90);

    const firstEnabledAt = row.nextVisitOfferEnabledAt!.getTime();

    await PATCH(request('PATCH', 'one', { ...settings(true, ['a']), value: 15 }));
    row = (await db.select().from(schema.salonRetentionSettingsSchema))[0]!;

    expect(row.nextVisitOfferEnabledAt!.getTime()).toBe(firstEnabledAt);
    expect(row.nextVisitOffer).toMatchObject({ value: 15 });

    await PATCH(request('PATCH', 'one', settings(false, ['a'])));
    await new Promise(resolve => setTimeout(resolve, 1));
    await PATCH(request('PATCH', 'one', settings(true, ['a'])));
    row = (await db.select().from(schema.salonRetentionSettingsSchema))[0]!;

    expect(row.nextVisitOfferEnabledAt!.getTime()).toBeGreaterThanOrEqual(firstEnabledAt);
  });

  it('rejects selected services from another tenant', async () => {
    const response = await PATCH(request('PATCH', 'one', settings(true, ['b'])));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_SERVICES');
  });
});
