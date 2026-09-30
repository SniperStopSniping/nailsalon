import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { PATCH } from './route';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  impersonation: null as unknown,
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
}));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/adminAuth', () => ({
  COOKIE_OPTIONS: { httpOnly: true, path: '/', sameSite: 'lax' },
  getAdminSession: vi.fn(async () => holder.session),
  getAdminImpersonationForAdmin: vi.fn(async () => holder.impersonation),
}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: holder.cookieGet, set: holder.cookieSet })) }));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function request(salonId: string, hidden: unknown) {
  return PATCH(new Request(`http://localhost/api/admin/salons/${salonId}/chooser-visibility`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hidden }),
  }), { params: Promise.resolve({ salonId }) });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await db.insert(schema.salonSchema).values([
    { id: 's1', slug: 'one', name: 'One' },
    { id: 's2', slug: 'two', name: 'Two' },
  ]);
  await db.insert(schema.adminUserSchema).values([{ id: 'owner-a' }, { id: 'owner-b' }, { id: 'collaborator' }]);
  await db.insert(schema.adminSalonMembershipSchema).values([
    { adminId: 'owner-a', salonId: 's1', role: 'owner' },
    { adminId: 'owner-b', salonId: 's1', role: 'owner' },
    { adminId: 'collaborator', salonId: 's2', role: 'admin' },
  ]);
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  holder.impersonation = null;
  holder.session = { id: 'owner-a', salons: [{ salonId: 's1', salonSlug: 'one', role: 'owner' }] };
  holder.cookieGet.mockReturnValue({ value: 'one' });
  await db.update(schema.adminSalonMembershipSchema).set({ hiddenFromChooserAt: null });
});

afterAll(async () => {
  await client.close();
});

describe('owner salon chooser visibility', () => {
  it('hides and restores only the requesting owner’s membership', async () => {
    expect((await request('s1', true)).status).toBe(200);

    const hidden = await db.select().from(schema.adminSalonMembershipSchema).where(eq(schema.adminSalonMembershipSchema.salonId, 's1'));

    expect(hidden.find(row => row.adminId === 'owner-a')?.hiddenFromChooserAt).toBeInstanceOf(Date);
    expect(hidden.find(row => row.adminId === 'owner-b')?.hiddenFromChooserAt).toBeNull();
    expect(holder.cookieSet).toHaveBeenCalledWith('__active_salon_slug', '', expect.objectContaining({ maxAge: 0 }));

    expect((await request('s1', false)).status).toBe(200);

    const restored = await db.select().from(schema.adminSalonMembershipSchema).where(eq(schema.adminSalonMembershipSchema.adminId, 'owner-a'));

    expect(restored[0]?.hiddenFromChooserAt).toBeNull();
  });

  it('rejects a foreign salon, a collaborator, and impersonation', async () => {
    expect((await request('s2', true)).status).toBe(403);

    holder.session = { id: 'collaborator', salons: [{ salonId: 's2', salonSlug: 'two', role: 'admin' }] };

    expect((await request('s2', true)).status).toBe(403);

    holder.session = { id: 'owner-a', salons: [{ salonId: 's1', salonSlug: 'one', role: 'owner' }] };
    holder.impersonation = { salonId: 's1' };

    expect((await request('s1', true)).status).toBe(403);
    expect((await db.select().from(schema.adminSalonMembershipSchema)).every(row => row.hiddenFromChooserAt === null)).toBe(true);
  });

  it('rejects unsigned requests and malformed bodies', async () => {
    holder.session = null;

    expect((await request('s1', true)).status).toBe(401);

    holder.session = { id: 'owner-a', salons: [{ salonId: 's1', salonSlug: 'one', role: 'owner' }] };

    expect((await request('s1', 'yes')).status).toBe(400);
  });
});
