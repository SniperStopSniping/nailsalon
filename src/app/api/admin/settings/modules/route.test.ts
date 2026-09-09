import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown, requireAdminSalon: vi.fn() }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: holder.requireAdminSalon }));

/* eslint-disable import/first */
import { GET, PUT } from './route';
/* eslint-enable import/first */

let client: PGlite;
let database: PgliteDatabase<typeof schema>;
const salonId = 'sms-module-free';
const otherSalonId = 'sms-module-other';

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  database = drizzle(client, { schema });
  holder.db = database;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await database.insert(schema.salonSchema).values([salonId, otherSalonId].map(id => ({
    id,
    slug: id,
    name: 'SMS module fixture',
    plan: 'free' as const,
    features: { smsReminders: false, marketing: { smsReminders: false } },
  })));
});

beforeEach(async () => {
  holder.requireAdminSalon.mockReset();
  holder.requireAdminSalon.mockImplementation(async (slug: string) => {
    if (slug !== salonId) {
      return { error: Response.json({ error: 'Forbidden' }, { status: 403 }), salon: null };
    }
    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));
    return { error: null, salon };
  });
  await database.update(schema.salonSchema).set({
    settings: { modules: { smsReminders: false }, communications: { sms: { enabled: false } } },
  });
});

afterAll(async () => {
  await client.close();
});

function updateRequest(slug: string, modules: Record<string, boolean>) {
  return new Request('http://localhost/api/admin/settings/modules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salonSlug: slug, modules }),
  });
}

describe('module API SMS access on Free', () => {
  it('reports an owner-disabled SMS module as included, retaining paid-feature restrictions', async () => {
    const response = await GET(new Request(`http://localhost/api/admin/settings/modules?salonSlug=${salonId}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: {
      entitledModules: { smsReminders: true, rewards: false, analyticsDashboard: false },
      modules: { smsReminders: false },
      moduleReasons: { smsReminders: 'MODULE_DISABLED', rewards: 'UPGRADE_REQUIRED' },
    } });
  });

  it('lets the owner change the SMS module without activating communications or changing other salons', async () => {
    const response = await PUT(updateRequest(salonId, { smsReminders: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { modules: { smsReminders: true }, moduleReasons: { smsReminders: 'ENABLED' } } });

    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));
    const [otherSalon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, otherSalonId));

    expect(salon?.settings).toMatchObject({ modules: { smsReminders: true }, communications: { sms: { enabled: false } } });
    expect(otherSalon?.settings?.modules?.smsReminders).toBe(false);
    expect(salon?.features?.marketing?.smsReminders).toBe(false);
  });

  it('still rejects enabling another paid module on Free', async () => {
    const response = await PUT(updateRequest(salonId, { rewards: true }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'UPGRADE_REQUIRED' } });
  });

  it('denies a foreign salon read and update before exposing or changing module settings', async () => {
    const read = await GET(new Request(`http://localhost/api/admin/settings/modules?salonSlug=${otherSalonId}`));
    const update = await PUT(updateRequest(otherSalonId, { smsReminders: true }));

    expect(read.status).toBe(403);
    expect(update.status).toBe(403);
    expect(holder.requireAdminSalon).toHaveBeenCalledWith(otherSalonId);

    const [otherSalon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, otherSalonId));

    expect(otherSalon?.settings?.modules?.smsReminders).toBe(false);
  });
});
