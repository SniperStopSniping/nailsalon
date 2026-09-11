/**
 * PUT /api/salon/services/[id]/add-ons — the SERVICE side of the
 * `service_add_on` relationship.
 *
 * The load-bearing guarantees are:
 *  - it writes join rows and NOTHING else (an add-on's own price, duration
 *    and active state are untouchable from here);
 *  - it is scoped to one service, so an add-on's bindings to OTHER services
 *    survive;
 *  - surviving rows keep owner-tuned join columns;
 *  - it and the add-on-side PATCH read and write the SAME rows, so the two
 *    directions can never disagree or fork a duplicate add-on.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
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
import { PATCH as PATCH_ADD_ON } from '../../../add-ons/[id]/route';
import { PUT } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_svc_addons';
const SALON_SLUG = 'svc-addons-salon';
const OTHER_SALON_ID = 'salon_svc_addons_other';
const SERVICE_A = 'srv_gel_manicure';
const SERVICE_B = 'srv_biab';
const FOREIGN_SERVICE = 'srv_foreign';
const ADD_ON_FRENCH = 'addon_french_tips';
const ADD_ON_CHROME = 'addon_chrome';
const FOREIGN_ADD_ON = 'addon_foreign';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function putRequest(
  id: string,
  body: unknown,
): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/salon/services/${id}/add-ons`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

function addOnPatchRequest(
  id: string,
  body: unknown,
): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/salon/add-ons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

async function addOnIdsForService(serviceId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(schema.serviceAddOnSchema)
    .where(eq(schema.serviceAddOnSchema.serviceId, serviceId));
  return rows.map(row => row.addOnId).sort();
}

async function serviceIdsForAddOn(addOnId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(schema.serviceAddOnSchema)
    .where(eq(schema.serviceAddOnSchema.addOnId, addOnId));
  return rows.map(row => row.serviceId).sort();
}

async function countJoinRows(): Promise<number> {
  return (await db.select().from(schema.serviceAddOnSchema)).length;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Service Add-ons Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Foreign Salon', slug: 'svc-addons-foreign', settings: {} },
  ]);
  await db.insert(schema.serviceSchema).values([
    { id: SERVICE_A, salonId: SALON_ID, name: 'Gel Manicure', category: 'manicure', price: 4500, durationMinutes: 60 },
    { id: SERVICE_B, salonId: SALON_ID, name: 'BIAB', category: 'manicure', price: 6500, durationMinutes: 90 },
    { id: FOREIGN_SERVICE, salonId: OTHER_SALON_ID, name: 'Foreign Service', category: 'manicure', price: 1000, durationMinutes: 30 },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.serviceAddOnSchema);
  await db.delete(schema.addOnSchema);
  await db.insert(schema.addOnSchema).values([
    {
      id: ADD_ON_FRENCH,
      salonId: SALON_ID,
      name: 'French Tips',
      slug: 'french-tips',
      category: 'nail_art',
      templateKey: 'french_tips',
      priceCents: 1000,
      priceDisplayText: '$10+',
      durationMinutes: 15,
      displayOrder: 0,
      isActive: true,
    },
    {
      id: ADD_ON_CHROME,
      salonId: SALON_ID,
      name: 'Chrome — Hands',
      slug: 'chrome-hands',
      category: 'nail_art',
      templateKey: 'chrome',
      priceCents: 1000,
      durationMinutes: 15,
      displayOrder: 1,
      isActive: false,
    },
    {
      id: FOREIGN_ADD_ON,
      salonId: OTHER_SALON_ID,
      name: 'Foreign Add-on',
      slug: 'foreign-addon',
      category: 'repair',
      priceCents: 700,
      durationMinutes: 10,
    },
  ]);
  // French Tips starts offered with BOTH services; Chrome with neither.
  await db.insert(schema.serviceAddOnSchema).values([
    {
      id: 'svcaddon_seed_a_french',
      salonId: SALON_ID,
      serviceId: SERVICE_A,
      addOnId: ADD_ON_FRENCH,
      selectionMode: 'optional',
      displayOrder: 7,
      maxQuantityOverride: 3,
    },
    {
      id: 'svcaddon_seed_b_french',
      salonId: SALON_ID,
      serviceId: SERVICE_B,
      addOnId: ADD_ON_FRENCH,
      selectionMode: 'optional',
      displayOrder: 0,
    },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('PUT /api/salon/services/[id]/add-ons', () => {
  it('rejects unauthenticated callers and writes nothing', async () => {
    holder.adminSalon = null;

    const response = await PUT(...putRequest(SERVICE_A, { salonSlug: SALON_SLUG, addOnIds: [] }));

    expect(response.status).toBe(401);
    expect(await addOnIdsForService(SERVICE_A)).toEqual([ADD_ON_FRENCH]);
  });

  it('refuses a service belonging to another salon and writes nothing', async () => {
    const response = await PUT(...putRequest(FOREIGN_SERVICE, {
      salonSlug: SALON_SLUG,
      addOnIds: [ADD_ON_CHROME],
    }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('SERVICE_NOT_FOUND');
    expect(await countJoinRows()).toBe(2);
  });

  it('refuses an add-on belonging to another salon and writes nothing', async () => {
    const response = await PUT(...putRequest(SERVICE_A, {
      salonSlug: SALON_SLUG,
      addOnIds: [ADD_ON_CHROME, FOREIGN_ADD_ON],
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_ADD_ON_SELECTION');
    // The whole request is rejected, not partially applied.
    expect(await addOnIdsForService(SERVICE_A)).toEqual([ADD_ON_FRENCH]);
  });

  it('adds an add-on to one service without touching its other services', async () => {
    const response = await PUT(...putRequest(SERVICE_A, {
      salonSlug: SALON_SLUG,
      addOnIds: [ADD_ON_FRENCH, ADD_ON_CHROME],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect([...body.data.addOnIds].sort()).toEqual([ADD_ON_CHROME, ADD_ON_FRENCH]);
    expect(await addOnIdsForService(SERVICE_A)).toEqual([ADD_ON_CHROME, ADD_ON_FRENCH]);
    // Chrome was added to A only.
    expect(await serviceIdsForAddOn(ADD_ON_CHROME)).toEqual([SERVICE_A]);
    // French Tips keeps its OTHER binding.
    expect(await serviceIdsForAddOn(ADD_ON_FRENCH)).toEqual([SERVICE_B, SERVICE_A].sort());
  });

  it('removes an add-on from one service and leaves its other services alone', async () => {
    await PUT(...putRequest(SERVICE_A, { salonSlug: SALON_SLUG, addOnIds: [] }));

    expect(await addOnIdsForService(SERVICE_A)).toEqual([]);
    // The point of the whole endpoint: B still offers French Tips.
    expect(await serviceIdsForAddOn(ADD_ON_FRENCH)).toEqual([SERVICE_B]);
  });

  it('never edits the add-on record itself', async () => {
    await PUT(...putRequest(SERVICE_A, {
      salonSlug: SALON_SLUG,
      addOnIds: [ADD_ON_CHROME],
    }));

    const [french] = await db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, ADD_ON_FRENCH));
    const [chrome] = await db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, ADD_ON_CHROME));

    // Unbinding French Tips left its price, marketing string and state alone.
    expect(french).toMatchObject({
      name: 'French Tips',
      priceCents: 1000,
      priceDisplayText: '$10+',
      durationMinutes: 15,
      isActive: true,
    });
    // Binding an INACTIVE add-on does not quietly activate it — the add-on's
    // own bookable state is the add-on editor's business, not this route's.
    expect(chrome!.isActive).toBe(false);
    expect(chrome!.priceCents).toBe(1000);
  });

  it('leaves surviving join rows exactly as stored', async () => {
    await PUT(...putRequest(SERVICE_A, {
      salonSlug: SALON_SLUG,
      addOnIds: [ADD_ON_CHROME, ADD_ON_FRENCH],
    }));

    const [survivor] = await db
      .select()
      .from(schema.serviceAddOnSchema)
      .where(and(
        eq(schema.serviceAddOnSchema.serviceId, SERVICE_A),
        eq(schema.serviceAddOnSchema.addOnId, ADD_ON_FRENCH),
      ));

    // Owner-tuned columns are not reset by an unrelated edit.
    expect(survivor).toMatchObject({
      id: 'svcaddon_seed_a_french',
      displayOrder: 7,
      maxQuantityOverride: 3,
    });
  });

  it('is idempotent and never forks a duplicate row for one pair', async () => {
    await PUT(...putRequest(SERVICE_A, { salonSlug: SALON_SLUG, addOnIds: [ADD_ON_CHROME] }));
    await PUT(...putRequest(SERVICE_A, { salonSlug: SALON_SLUG, addOnIds: [ADD_ON_CHROME] }));
    await PUT(...putRequest(SERVICE_A, { salonSlug: SALON_SLUG, addOnIds: [ADD_ON_CHROME] }));

    const rows = await db
      .select()
      .from(schema.serviceAddOnSchema)
      .where(eq(schema.serviceAddOnSchema.serviceId, SERVICE_A));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.addOnId).toBe(ADD_ON_CHROME);
  });

  it('deduplicates a repeated add-on id instead of rejecting it', async () => {
    const response = await PUT(...putRequest(SERVICE_A, {
      salonSlug: SALON_SLUG,
      addOnIds: [ADD_ON_CHROME, ADD_ON_CHROME],
    }));

    expect(response.status).toBe(200);
    expect(await addOnIdsForService(SERVICE_A)).toEqual([ADD_ON_CHROME]);
  });

  it('rejects a body with no addOnIds rather than guessing', async () => {
    const response = await PUT(...putRequest(SERVICE_A, { salonSlug: SALON_SLUG }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(await addOnIdsForService(SERVICE_A)).toEqual([ADD_ON_FRENCH]);
  });
});

describe('one relationship, two directions', () => {
  it('shows a service-side binding to the add-on side', async () => {
    await PUT(...putRequest(SERVICE_A, {
      salonSlug: SALON_SLUG,
      addOnIds: [ADD_ON_FRENCH, ADD_ON_CHROME],
    }));

    // Read it back through the add-on-side writer's own response shape.
    const response = await PATCH_ADD_ON(...addOnPatchRequest(ADD_ON_CHROME, {
      salonSlug: SALON_SLUG,
      name: 'Chrome — Hands',
      priceCents: 1000,
      durationMinutes: 15,
      isActive: false,
      // serviceIds omitted ⇒ bindings untouched.
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.addOn.compatibleServiceIds).toEqual([SERVICE_A]);
  });

  it('shows an add-on-side binding to the service side', async () => {
    await PATCH_ADD_ON(...addOnPatchRequest(ADD_ON_CHROME, {
      salonSlug: SALON_SLUG,
      name: 'Chrome — Hands',
      priceCents: 1000,
      durationMinutes: 15,
      isActive: false,
      serviceIds: [SERVICE_A, SERVICE_B],
    }));

    expect(await addOnIdsForService(SERVICE_A)).toEqual([ADD_ON_CHROME, ADD_ON_FRENCH]);
    expect(await addOnIdsForService(SERVICE_B)).toEqual([ADD_ON_CHROME, ADD_ON_FRENCH]);
  });

  it('lets the two directions edit the same rows without duplicating them', async () => {
    // Add-on side: French Tips offered with A and B (already true), Chrome with B.
    await PATCH_ADD_ON(...addOnPatchRequest(ADD_ON_CHROME, {
      salonSlug: SALON_SLUG,
      name: 'Chrome — Hands',
      priceCents: 1000,
      durationMinutes: 15,
      isActive: false,
      serviceIds: [SERVICE_B],
    }));

    // Service side: A now offers Chrome too.
    await PUT(...putRequest(SERVICE_A, {
      salonSlug: SALON_SLUG,
      addOnIds: [ADD_ON_FRENCH, ADD_ON_CHROME],
    }));

    // Add-on side again: drop Chrome from B only.
    await PATCH_ADD_ON(...addOnPatchRequest(ADD_ON_CHROME, {
      salonSlug: SALON_SLUG,
      name: 'Chrome — Hands',
      priceCents: 1000,
      durationMinutes: 15,
      isActive: false,
      serviceIds: [SERVICE_A],
    }));

    expect(await serviceIdsForAddOn(ADD_ON_CHROME)).toEqual([SERVICE_A]);
    expect(await serviceIdsForAddOn(ADD_ON_FRENCH)).toEqual([SERVICE_B, SERVICE_A].sort());
    // Two add-ons, three bindings, no forked rows.
    expect(await countJoinRows()).toBe(3);
    expect((await db.select().from(schema.addOnSchema)).filter(row => row.salonId === SALON_ID)).toHaveLength(2);
  });
});
