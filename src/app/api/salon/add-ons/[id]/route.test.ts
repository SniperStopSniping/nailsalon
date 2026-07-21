/**
 * PATCH /api/salon/add-ons/[id] — the owner add-on editor's save path.
 *
 * The load-bearing guarantee is that saving always UPDATES the row it was
 * opened from: no insert path exists here, so an edit can never leave the
 * salon with two copies of an add-on, and compatibility edits must not
 * duplicate service_add_on rows either.
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
import { PATCH } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_addon_patch';
const SALON_SLUG = 'addon-patch-salon';
const OTHER_SALON_ID = 'salon_addon_patch_other';
const ADD_ON_ID = 'addon_patch_target';
const FOREIGN_ADD_ON_ID = 'addon_patch_foreign';
const SERVICE_A = 'srv_patch_a';
const SERVICE_B = 'srv_patch_b';
const FOREIGN_SERVICE = 'srv_patch_foreign';

const VALID_BODY = {
  salonSlug: SALON_SLUG,
  name: 'Chrome',
  priceCents: 1000,
  priceDisplayText: null,
  durationMinutes: 15,
  maxQuantity: null,
  isActive: true,
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function patchRequest(id: string, body: unknown): [Request, { params: { id: string } }] {
  return [
    new Request(`http://localhost/api/salon/add-ons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  ];
}

async function countAddOns() {
  return (await db.select().from(schema.addOnSchema)).length;
}

async function linkedServiceIds(addOnId: string) {
  const rows = await db
    .select()
    .from(schema.serviceAddOnSchema)
    .where(eq(schema.serviceAddOnSchema.addOnId, addOnId));
  return rows.map(row => row.serviceId).sort();
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Add-on Patch Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Foreign Salon', slug: 'addon-patch-foreign', settings: {} },
  ]);
  await db.insert(schema.serviceSchema).values([
    { id: SERVICE_A, salonId: SALON_ID, name: 'Gel Manicure', category: 'manicure', price: 4500, durationMinutes: 60 },
    { id: SERVICE_B, salonId: SALON_ID, name: 'Gel Pedicure', category: 'pedicure', price: 5500, durationMinutes: 60 },
    { id: FOREIGN_SERVICE, salonId: OTHER_SALON_ID, name: 'Foreign', category: 'manicure', price: 1000, durationMinutes: 30 },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.serviceAddOnSchema);
  await db.delete(schema.addOnSchema);
  await db.insert(schema.addOnSchema).values([
    {
      id: ADD_ON_ID,
      salonId: SALON_ID,
      name: 'Chrome',
      slug: 'chrome',
      category: 'nail_art',
      templateKey: 'chrome',
      descriptionItems: ['Mirror finish'],
      priceCents: 1000,
      durationMinutes: 15,
      displayOrder: 1,
    },
    {
      id: FOREIGN_ADD_ON_ID,
      salonId: OTHER_SALON_ID,
      name: 'Foreign Add-on',
      slug: 'foreign-addon',
      category: 'repair',
      priceCents: 700,
      durationMinutes: 10,
    },
  ]);
  await db.insert(schema.serviceAddOnSchema).values({
    id: 'svcaddon_seed_a',
    salonId: SALON_ID,
    serviceId: SERVICE_A,
    addOnId: ADD_ON_ID,
    selectionMode: 'optional',
    displayOrder: 0,
  });
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /api/salon/add-ons/[id]', () => {
  it('rejects unauthenticated callers and leaves the row unchanged', async () => {
    holder.adminSalon = null;

    const response = await PATCH(...patchRequest(ADD_ON_ID, { ...VALID_BODY, priceCents: 9999 }));
    const [row] = await db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, ADD_ON_ID));

    expect(response.status).toBe(401);
    expect(row!.priceCents).toBe(1000);
  });

  it('updates the same record instead of creating another copy', async () => {
    const before = await countAddOns();

    const response = await PATCH(...patchRequest(ADD_ON_ID, { ...VALID_BODY, priceCents: 1800 }));
    const body = await response.json();
    const [row] = await db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, ADD_ON_ID));

    expect(response.status).toBe(200);
    expect(body.data.addOn.id).toBe(ADD_ON_ID);
    expect(row!.priceCents).toBe(1800);
    expect(await countAddOns()).toBe(before);
  });

  it('saves name, description, duration, and active state on that row', async () => {
    await PATCH(...patchRequest(ADD_ON_ID, {
      ...VALID_BODY,
      name: 'Chrome — Hands',
      descriptionItems: ['Mirror finish', 'Any colour'],
      durationMinutes: 20,
      isActive: false,
    }));

    const [row] = await db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, ADD_ON_ID));

    expect(row).toMatchObject({
      name: 'Chrome — Hands',
      descriptionItems: ['Mirror finish', 'Any colour'],
      durationMinutes: 20,
      isActive: false,
    });
  });

  it('leaves compatibility alone when serviceIds is omitted', async () => {
    await PATCH(...patchRequest(ADD_ON_ID, VALID_BODY));

    expect(await linkedServiceIds(ADD_ON_ID)).toEqual([SERVICE_A]);
  });

  it('reconciles compatible services without duplicating rows', async () => {
    const response = await PATCH(...patchRequest(ADD_ON_ID, {
      ...VALID_BODY,
      serviceIds: [SERVICE_A, SERVICE_B],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(await linkedServiceIds(ADD_ON_ID)).toEqual([SERVICE_A, SERVICE_B].sort());
    expect([...body.data.addOn.compatibleServiceIds].sort()).toEqual([SERVICE_A, SERVICE_B].sort());

    // Saving the identical selection again is a no-op, not a second set of rows.
    await PATCH(...patchRequest(ADD_ON_ID, { ...VALID_BODY, serviceIds: [SERVICE_A, SERVICE_B] }));

    expect(await linkedServiceIds(ADD_ON_ID)).toEqual([SERVICE_A, SERVICE_B].sort());
  });

  it('removes links the owner unchecked', async () => {
    await PATCH(...patchRequest(ADD_ON_ID, { ...VALID_BODY, serviceIds: [SERVICE_B] }));

    expect(await linkedServiceIds(ADD_ON_ID)).toEqual([SERVICE_B]);

    await PATCH(...patchRequest(ADD_ON_ID, { ...VALID_BODY, serviceIds: [] }));

    expect(await linkedServiceIds(ADD_ON_ID)).toEqual([]);
  });

  it('refuses to link another salon’s service', async () => {
    const response = await PATCH(...patchRequest(ADD_ON_ID, {
      ...VALID_BODY,
      serviceIds: [SERVICE_A, FOREIGN_SERVICE],
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_SERVICE_SELECTION');
    // The whole save is rolled back, links included.
    expect(await linkedServiceIds(ADD_ON_ID)).toEqual([SERVICE_A]);
  });

  it('cannot edit an add-on belonging to another salon', async () => {
    const response = await PATCH(...patchRequest(FOREIGN_ADD_ON_ID, { ...VALID_BODY, priceCents: 1 }));
    const [row] = await db
      .select()
      .from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.id, FOREIGN_ADD_ON_ID));

    expect(response.status).toBe(404);
    expect(row!.priceCents).toBe(700);
  });

  it('rejects an invalid payload', async () => {
    const response = await PATCH(...patchRequest(ADD_ON_ID, { ...VALID_BODY, name: '' }));

    expect(response.status).toBe(400);
  });
});
