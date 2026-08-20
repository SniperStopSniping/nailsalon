/**
 * GET/POST /api/salon/add-on-groups — the FIRST writer `add_on_group` has
 * ever had (migration 0073 created it empty and dark). Load-bearing
 * guarantees: unauthenticated/cross-salon callers are rejected, selection
 * bounds are validated by the SAME `addOnGroupBoundsSchema` migration
 * 0073's CHECKs mirror, and every created group is scoped to the calling
 * salon.
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
import { GET, POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_group_route';
const SALON_SLUG = 'group-route-salon';
const OTHER_SALON_ID = 'salon_group_route_other';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function getRequest(salonSlug: string): Request {
  return new Request(`http://localhost/api/salon/add-on-groups?salonSlug=${salonSlug}`);
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/salon/add-on-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  salonSlug: SALON_SLUG,
  name: 'Nail Shapes',
  minSelections: 1,
  maxSelections: 1,
};

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Group Route Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'group-route-other', settings: {} },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.addOnSchema);
  await db.delete(schema.addOnGroupSchema);
});

afterAll(async () => {
  await client.close();
});

describe('GET /api/salon/add-on-groups', () => {
  it('rejects unauthenticated callers', async () => {
    holder.adminSalon = null;
    const response = await GET(getRequest(SALON_SLUG));

    expect(response.status).toBe(401);
  });

  it('lists groups with their member add-on ids', async () => {
    await db.insert(schema.addOnGroupSchema).values({
      id: 'grp_seed',
      salonId: SALON_ID,
      name: 'Shapes',
      slug: 'shapes',
      minSelections: 1,
      maxSelections: 1,
    });
    await db.insert(schema.addOnSchema).values({
      id: 'addon_seed',
      salonId: SALON_ID,
      name: 'Square',
      slug: 'square',
      category: 'nail_art',
      priceCents: 500,
      durationMinutes: 10,
      groupId: 'grp_seed',
    });

    const response = await GET(getRequest(SALON_SLUG));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.groups).toHaveLength(1);
    expect(body.data.groups[0]).toMatchObject({ id: 'grp_seed', memberAddOnIds: ['addon_seed'] });
  });

  it('never returns another salon’s groups', async () => {
    await db.insert(schema.addOnGroupSchema).values({
      id: 'grp_foreign',
      salonId: OTHER_SALON_ID,
      name: 'Foreign',
      slug: 'foreign',
      minSelections: 0,
      maxSelections: null,
    });

    const response = await GET(getRequest(SALON_SLUG));
    const body = await response.json();

    expect(body.data.groups).toHaveLength(0);
  });
});

describe('POST /api/salon/add-on-groups', () => {
  it('rejects unauthenticated callers and creates nothing', async () => {
    holder.adminSalon = null;
    const response = await POST(postRequest(VALID_BODY));
    const rows = await db.select().from(schema.addOnGroupSchema);

    expect(response.status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it('creates a group scoped to the calling salon', async () => {
    const response = await POST(postRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.group).toMatchObject({ name: 'Nail Shapes', minSelections: 1, maxSelections: 1, memberAddOnIds: [] });

    const [row] = await db.select().from(schema.addOnGroupSchema).where(eq(schema.addOnGroupSchema.id, body.data.group.id));

    expect(row!.salonId).toBe(SALON_ID);
  });

  it('rejects maxSelections below minSelections (mirrors add_on_group_min_max_compatible_check)', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, minSelections: 3, maxSelections: 1 }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects maxSelections of 0 (mirrors add_on_group_max_selections_check)', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, minSelections: 0, maxSelections: 0 }));

    expect(response.status).toBe(400);
  });

  it('rejects a blank name', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, name: '   ' }));

    expect(response.status).toBe(400);
  });

  it('accepts null maxSelections as unlimited', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, minSelections: 1, maxSelections: null }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.group.maxSelections).toBeNull();
  });
});
