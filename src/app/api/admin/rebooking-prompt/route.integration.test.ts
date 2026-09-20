import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { GET, PATCH } from './route';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ audit: vi.fn(), db: null as unknown, salon: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/adminAuth', () => ({
  getAdminSession: vi.fn(async () => ({ id: 'admin-a' })),
  requireAdminSalon: vi.fn(async () => holder.salon),
}));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: holder.audit }));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function request(method: 'GET' | 'PATCH', body?: unknown) {
  return new Request('http://luster.test/api/admin/rebooking-prompt?salonSlug=one', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await db.insert(schema.salonSchema).values({ id: 'salon-a', name: 'One', slug: 'one' });
}, 60_000);

beforeEach(async () => {
  const settings = {
    booking: { timezone: 'America/Toronto' },
    communications: { sms: { enabled: true } },
  };
  await db.update(schema.salonSchema).set({ settings }).where(eq(schema.salonSchema.id, 'salon-a'));
  holder.salon = { salon: { id: 'salon-a', settings } };
  vi.clearAllMocks();
});

afterAll(async () => {
  await client.close();
});

describe('rebooking prompt settings integration', () => {
  it('defaults existing salons off and atomically changes only its own JSONB key', async () => {
    expect((await (await GET(request('GET'))).json()).data.settings).toEqual({ enabled: false });

    const response = await PATCH(request('PATCH', { enabled: true }));

    expect(response.status).toBe(200);

    const [stored] = await db.select({ settings: schema.salonSchema.settings })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, 'salon-a'));

    expect(stored?.settings).toMatchObject({
      booking: { timezone: 'America/Toronto' },
      communications: { sms: { enabled: true } },
      rebookingPrompt: { enabled: true },
    });
  });
});
