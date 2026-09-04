/**
 * PATCH /api/salon/add-ons/[id] — the `groupId` binding this PR adds.
 * `route.test.ts` (unmodified) covers every pre-existing PATCH guarantee;
 * this file covers only the NEW `add_on.group_id` behaviour: omitted ⇒
 * unchanged, explicit `null` ⇒ ungroup, and a same-salon requirement.
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

const SALON_ID = 'salon_addon_group_bind';
const SALON_SLUG = 'addon-group-bind-salon';
const OTHER_SALON_ID = 'salon_addon_group_bind_other';
const ADD_ON_ID = 'addon_group_bind_target';
const GROUP_ID = 'grp_bind_target';
const FOREIGN_GROUP_ID = 'grp_bind_foreign';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function patchRequest(id: string, body: unknown): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/salon/add-ons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

const VALID_BODY = {
  salonSlug: SALON_SLUG,
  name: 'Chrome',
  priceCents: 1000,
  priceDisplayText: null,
  durationMinutes: 15,
  maxQuantity: null,
  isActive: true,
};

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Add-on Group Bind Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Foreign Salon', slug: 'addon-group-bind-foreign', settings: {} },
  ]);
});

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.addOnSchema);
  await db.delete(schema.addOnGroupSchema);
  await db.insert(schema.addOnGroupSchema).values([
    { id: GROUP_ID, salonId: SALON_ID, name: 'Finishes', slug: 'finishes-bind', minSelections: 0, maxSelections: 1 },
    { id: FOREIGN_GROUP_ID, salonId: OTHER_SALON_ID, name: 'Foreign', slug: 'foreign-bind', minSelections: 0, maxSelections: null },
  ]);
  await db.insert(schema.addOnSchema).values({
    id: ADD_ON_ID,
    salonId: SALON_ID,
    name: 'Chrome',
    slug: 'chrome-bind',
    category: 'nail_art',
    priceCents: 1000,
    durationMinutes: 15,
  });
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /api/salon/add-ons/[id] — group binding', () => {
  it('leaves group_id unchanged when omitted', async () => {
    await db.update(schema.addOnSchema).set({ groupId: GROUP_ID }).where(eq(schema.addOnSchema.id, ADD_ON_ID));

    await PATCH(...patchRequest(ADD_ON_ID, VALID_BODY));

    const [row] = await db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, ADD_ON_ID));

    expect(row!.groupId).toBe(GROUP_ID);
  });

  it('binds a same-salon group', async () => {
    const response = await PATCH(...patchRequest(ADD_ON_ID, { ...VALID_BODY, groupId: GROUP_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.addOn.groupId).toBe(GROUP_ID);
  });

  it('clears group_id on explicit null', async () => {
    await db.update(schema.addOnSchema).set({ groupId: GROUP_ID }).where(eq(schema.addOnSchema.id, ADD_ON_ID));

    const response = await PATCH(...patchRequest(ADD_ON_ID, { ...VALID_BODY, groupId: null }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.addOn.groupId).toBeNull();
  });

  it('rejects a group from another salon and leaves the row unchanged', async () => {
    const response = await PATCH(...patchRequest(ADD_ON_ID, { ...VALID_BODY, groupId: FOREIGN_GROUP_ID }));
    const body = await response.json();
    const [row] = await db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, ADD_ON_ID));

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('GROUP_NOT_FOUND');
    expect(row!.groupId).toBeNull();
  });
});
