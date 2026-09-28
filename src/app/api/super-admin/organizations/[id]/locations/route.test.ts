import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock('@/libs/superAdmin', () => ({
  requireSuperAdmin: vi.fn(async () => null),
  logAuditAction: vi.fn(async () => undefined),
}));

const { POST } = await import('./route');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let db: Db;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

afterAll(async () => {
  await client.close();
});

describe('POST /api/super-admin/organizations/[id]/locations', () => {
  it('does not enforce a legacy stored maxLocations value', async () => {
    const salonId = 'legacy-location-cap';
    await db.delete(schema.salonLocationSchema);
    await db.delete(schema.salonSchema);
    await db.insert(schema.salonSchema).values({
      id: salonId,
      name: 'Legacy Capacity Salon',
      slug: 'legacy-capacity-salon',
      maxLocations: 1,
    });
    await db.insert(schema.salonLocationSchema).values({
      id: 'existing-location',
      salonId,
      name: 'Existing location',
      isPrimary: true,
    });

    const response = await POST(
      new Request(`http://localhost/api/super-admin/organizations/${salonId}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Second location' }),
      }),
      { params: Promise.resolve({ id: salonId }) },
    );

    expect(response.status).toBe(200);

    const locations = await db.select().from(schema.salonLocationSchema)
      .where(eq(schema.salonLocationSchema.salonId, salonId));

    expect(locations).toHaveLength(2);
  });
});
