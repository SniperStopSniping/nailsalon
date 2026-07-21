/**
 * GET /api/salon/add-ons — the owner Add-ons tab's only data source.
 *
 * Regression context: this endpoint returned 401 in production for every
 * Clerk-authenticated owner (it was missing from CLERK_CONTEXT_API_PREFIXES),
 * and the client swallowed it, so a salon with 33 add-ons rendered "0 add-ons".
 * The middleware half is covered by clerkApiContext.coverage.test.ts; this
 * covers the contract the tab depends on — every add-on, active or not,
 * scoped to the salon, with its compatible services.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
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
import { GET } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_addons_get';
const SALON_SLUG = 'addons-get-salon';
const OTHER_SALON_ID = 'salon_addons_get_other';
const SERVICE_ID = 'srv_addons_get';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function getRequest(slug = SALON_SLUG) {
  return new Request(
    `http://localhost/api/salon/add-ons?salonSlug=${encodeURIComponent(slug)}`,
  );
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Add-ons Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Foreign Salon', slug: 'addons-get-foreign', settings: {} },
  ]);
  await db.insert(schema.serviceSchema).values({
    id: SERVICE_ID,
    salonId: SALON_ID,
    name: 'Gel Manicure',
    category: 'manicure',
    price: 4500,
    durationMinutes: 60,
  });
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = null;
  await db.delete(schema.serviceAddOnSchema);
  await db.delete(schema.addOnSchema);
  await db.insert(schema.addOnSchema).values([
    {
      id: 'addon_chrome',
      salonId: SALON_ID,
      name: 'Chrome',
      slug: 'chrome',
      category: 'nail_art',
      templateKey: 'chrome',
      priceCents: 1000,
      durationMinutes: 15,
      displayOrder: 1,
    },
    {
      // Deactivated add-ons stay in the owner list so they can be revived.
      id: 'addon_retired',
      salonId: SALON_ID,
      name: 'Retired Art',
      slug: 'retired-art',
      category: 'nail_art',
      priceCents: 500,
      durationMinutes: 10,
      isActive: false,
      displayOrder: 2,
    },
    {
      id: 'addon_foreign',
      salonId: OTHER_SALON_ID,
      name: 'Someone Else’s Add-on',
      slug: 'foreign',
      category: 'repair',
      priceCents: 700,
      durationMinutes: 10,
    },
  ]);
  await db.insert(schema.serviceAddOnSchema).values({
    id: 'svcaddon_chrome',
    salonId: SALON_ID,
    serviceId: SERVICE_ID,
    addOnId: 'addon_chrome',
    selectionMode: 'optional',
    displayOrder: 0,
  });
});

afterAll(async () => {
  await client.close();
});

describe('GET /api/salon/add-ons', () => {
  it('rejects unauthenticated callers', async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
  });

  it('returns active AND inactive add-ons for the salon', async () => {
    holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.addOns).toHaveLength(2);
    expect(body.data.addOns.map((addOn: { id: string }) => addOn.id))
      .toEqual(['addon_chrome', 'addon_retired']);
    expect(body.data.addOns[1]).toMatchObject({ name: 'Retired Art', isActive: false });
  });

  it('never leaks another salon’s add-ons', async () => {
    holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };

    const body = await (await GET(getRequest())).json();

    expect(body.data.addOns.some((addOn: { id: string }) => addOn.id === 'addon_foreign')).toBe(false);
  });

  it('reports the base services each add-on is offered with', async () => {
    holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };

    const body = await (await GET(getRequest())).json();
    const [chrome, retired] = body.data.addOns;

    expect(chrome.compatibleServiceIds).toEqual([SERVICE_ID]);
    expect(retired.compatibleServiceIds).toEqual([]);
  });

  it('validates the salonSlug query parameter', async () => {
    const response = await GET(new Request('http://localhost/api/salon/add-ons'));

    expect(response.status).toBe(400);
  });
});
