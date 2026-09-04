/**
 * PATCH/DELETE /api/salon/add-on-groups/[id] — owner edits and deletion.
 * Load-bearing guarantee for DELETE: a group that still has members is
 * NEVER silently un-grouped as a side effect (migration 0073's own stated
 * design) — deletion is blocked with a readable reason instead.
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
import { DELETE, PATCH } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_group_id_route';
const SALON_SLUG = 'group-id-route-salon';
const OTHER_SALON_ID = 'salon_group_id_route_other';
const GROUP_ID = 'grp_id_route_target';
const FOREIGN_GROUP_ID = 'grp_id_route_foreign';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function patchRequest(id: string, body: unknown): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/salon/add-on-groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

function deleteRequest(id: string, salonSlug: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/salon/add-on-groups/${id}?salonSlug=${salonSlug}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  ];
}

const VALID_BODY = {
  salonSlug: SALON_SLUG,
  name: 'Nail Shapes',
  minSelections: 0,
  maxSelections: null,
};

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Group Id Route Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'group-id-route-other', settings: {} },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.addOnSchema);
  await db.delete(schema.addOnGroupSchema);
  await db.insert(schema.addOnGroupSchema).values([
    { id: GROUP_ID, salonId: SALON_ID, name: 'Shapes', slug: 'shapes-target', minSelections: 1, maxSelections: 1 },
    { id: FOREIGN_GROUP_ID, salonId: OTHER_SALON_ID, name: 'Foreign', slug: 'foreign-group', minSelections: 0, maxSelections: null },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /api/salon/add-on-groups/[id]', () => {
  it('rejects unauthenticated callers and leaves the row unchanged', async () => {
    holder.adminSalon = null;
    const response = await PATCH(...patchRequest(GROUP_ID, { ...VALID_BODY, name: 'Changed' }));
    const [row] = await db.select().from(schema.addOnGroupSchema).where(eq(schema.addOnGroupSchema.id, GROUP_ID));

    expect(response.status).toBe(401);
    expect(row!.name).toBe('Shapes');
  });

  it('updates name, description, bounds, and active state', async () => {
    const response = await PATCH(...patchRequest(GROUP_ID, {
      ...VALID_BODY,
      name: 'Nail Length',
      description: 'How long',
      minSelections: 1,
      maxSelections: 1,
      isActive: false,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.group).toMatchObject({ name: 'Nail Length', description: 'How long', minSelections: 1, maxSelections: 1, isActive: false });
  });

  it('rejects invalid bounds without writing', async () => {
    const response = await PATCH(...patchRequest(GROUP_ID, { ...VALID_BODY, minSelections: 5, maxSelections: 2 }));
    const [row] = await db.select().from(schema.addOnGroupSchema).where(eq(schema.addOnGroupSchema.id, GROUP_ID));

    expect(response.status).toBe(400);
    expect(row!.minSelections).toBe(1);
  });

  it('cannot edit a group belonging to another salon', async () => {
    const response = await PATCH(...patchRequest(FOREIGN_GROUP_ID, { ...VALID_BODY, name: 'Hijacked' }));
    const [row] = await db.select().from(schema.addOnGroupSchema).where(eq(schema.addOnGroupSchema.id, FOREIGN_GROUP_ID));

    expect(response.status).toBe(404);
    expect(row!.name).toBe('Foreign');
  });
});

describe('DELETE /api/salon/add-on-groups/[id]', () => {
  it('rejects unauthenticated callers', async () => {
    holder.adminSalon = null;
    const response = await DELETE(...deleteRequest(GROUP_ID, SALON_SLUG));

    expect(response.status).toBe(401);
  });

  it('deletes an empty group', async () => {
    const response = await DELETE(...deleteRequest(GROUP_ID, SALON_SLUG));
    const body = await response.json();
    const rows = await db.select().from(schema.addOnGroupSchema).where(eq(schema.addOnGroupSchema.id, GROUP_ID));

    expect(response.status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it('refuses to delete a group that still has members, and does not delete it', async () => {
    await db.insert(schema.addOnSchema).values({
      id: 'addon_member',
      salonId: SALON_ID,
      name: 'Square',
      slug: 'square-member',
      category: 'nail_art',
      priceCents: 500,
      durationMinutes: 10,
      groupId: GROUP_ID,
    });

    const response = await DELETE(...deleteRequest(GROUP_ID, SALON_SLUG));
    const body = await response.json();
    const rows = await db.select().from(schema.addOnGroupSchema).where(eq(schema.addOnGroupSchema.id, GROUP_ID));

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('GROUP_HAS_MEMBERS');
    expect(rows).toHaveLength(1);

    // The member's own group_id must be untouched too — deletion never
    // un-groups anything as a side effect.
    const [addOn] = await db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, 'addon_member'));

    expect(addOn!.groupId).toBe(GROUP_ID);
  });

  it('cannot delete another salon’s group', async () => {
    const response = await DELETE(...deleteRequest(FOREIGN_GROUP_ID, SALON_SLUG));
    const rows = await db.select().from(schema.addOnGroupSchema).where(eq(schema.addOnGroupSchema.id, FOREIGN_GROUP_ID));

    expect(response.status).toBe(404);
    expect(rows).toHaveLength(1);
  });
});
