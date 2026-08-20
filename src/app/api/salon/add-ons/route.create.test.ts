/**
 * POST /api/salon/add-ons — the FIRST insert path add-ons have ever had for
 * owner use (`route.ts`'s GET-only history). Load-bearing guarantees:
 * unauthenticated/cross-salon rejection, `group_id` binding validated
 * same-salon, and compatible-service binding is atomic with creation.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  adminSalon: null as null | { id: string; slug: string },
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async () => {
    if (holder.adminSalon) {
      return { salon: holder.adminSalon, error: null };
    }
    return { salon: null, error: new Response(null, { status: 401 }) };
  }),
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_addon_create';
const SALON_SLUG = 'addon-create-salon';
const OTHER_SALON_ID = 'salon_addon_create_other';
const GROUP_ID = 'grp_addon_create';
const FOREIGN_GROUP_ID = 'grp_addon_create_foreign';
const SERVICE_A = 'svc_addon_create_a';
const FOREIGN_SERVICE = 'svc_addon_create_foreign';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/salon/add-ons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  salonSlug: SALON_SLUG,
  name: 'Chrome Finish',
  category: 'nail_art',
  priceCents: 1200,
  durationMinutes: 15,
};

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Add-on Create Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'addon-create-other', settings: {} },
  ]);
  await db.insert(schema.serviceSchema).values([
    { id: SERVICE_A, salonId: SALON_ID, name: 'Gel Manicure', category: 'manicure', price: 4500, durationMinutes: 60 },
    { id: FOREIGN_SERVICE, salonId: OTHER_SALON_ID, name: 'Foreign', category: 'manicure', price: 1000, durationMinutes: 30 },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.serviceAddOnSchema);
  await db.delete(schema.addOnSchema);
  await db.delete(schema.addOnGroupSchema);
  await db.insert(schema.addOnGroupSchema).values([
    { id: GROUP_ID, salonId: SALON_ID, name: 'Finishes', slug: 'finishes-create', minSelections: 0, maxSelections: 1 },
    { id: FOREIGN_GROUP_ID, salonId: OTHER_SALON_ID, name: 'Foreign', slug: 'foreign-create', minSelections: 0, maxSelections: null },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('POST /api/salon/add-ons', () => {
  it('rejects unauthenticated callers and creates nothing', async () => {
    holder.adminSalon = null;
    const response = await POST(postRequest(VALID_BODY));
    const rows = await db.select().from(schema.addOnSchema);

    expect(response.status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it('creates an add-on scoped to the calling salon, ungrouped by default', async () => {
    const response = await POST(postRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.addOn).toMatchObject({ name: 'Chrome Finish', priceCents: 1200, groupId: null });

    const [row] = await db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, body.data.addOn.id));

    expect(row!.salonId).toBe(SALON_ID);
  });

  it('binds group_id when the group belongs to this salon', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, groupId: GROUP_ID }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.addOn.groupId).toBe(GROUP_ID);
  });

  it('rejects a group from another salon and creates nothing', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, groupId: FOREIGN_GROUP_ID }));
    const body = await response.json();
    const rows = await db.select().from(schema.addOnSchema);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('GROUP_NOT_FOUND');
    expect(rows).toHaveLength(0);
  });

  it('binds compatible services atomically with creation', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, serviceIds: [SERVICE_A] }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.addOn.compatibleServiceIds).toEqual([SERVICE_A]);

    const links = await db.select().from(schema.serviceAddOnSchema).where(eq(schema.serviceAddOnSchema.addOnId, body.data.addOn.id));

    expect(links).toHaveLength(1);
  });

  it('rejects a compatible service from another salon and creates no add-on at all (atomic)', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, serviceIds: [SERVICE_A, FOREIGN_SERVICE] }));
    const body = await response.json();
    const rows = await db.select().from(schema.addOnSchema);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_SERVICE_SELECTION');
    expect(rows).toHaveLength(0);
  });

  it('rejects an invalid payload', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, name: '' }));

    expect(response.status).toBe(400);
  });
});
