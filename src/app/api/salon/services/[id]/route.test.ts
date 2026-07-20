/**
 * PATCH /api/salon/services/[id] — the owner service editor's save path.
 * Covers authorization, tenant isolation, validation failure-states, and the
 * happy path (persisted fields + updatedAt bump). Booking-flow propagation of
 * price edits is covered by route.luster-price.integration.test.ts.
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

const SALON_ID = 'salon_svc_patch';
const SALON_SLUG = 'svc-patch-salon';
const OTHER_SALON_ID = 'salon_svc_patch_other';
const SERVICE_ID = 'srv_patch_target';
const FOREIGN_SERVICE_ID = 'srv_patch_foreign';

const VALID_BODY = {
  salonSlug: SALON_SLUG,
  name: 'Luster Manicure',
  description: null,
  descriptionItems: [],
  price: 5500,
  priceDisplayText: '',
  durationMinutes: 60,
  category: 'manicure',
  isIntroPrice: true,
  introPriceLabel: 'Intro price',
  isActive: true,
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function patchRequest(id: string, body: unknown): [Request, { params: { id: string } }] {
  return [
    new Request(`http://localhost/api/salon/services/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  ];
}

async function getServiceRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.serviceSchema)
    .where(eq(schema.serviceSchema.id, id));
  return row;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Patch Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Foreign Salon', slug: 'svc-patch-foreign', settings: {} },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = null;
  await db.delete(schema.serviceSchema);
  await db.insert(schema.serviceSchema).values([
    {
      id: SERVICE_ID,
      salonId: SALON_ID,
      name: 'Luster Manicure',
      category: 'manicure',
      price: 4500,
      priceDisplayText: '$75+',
      isIntroPrice: true,
      introPriceLabel: '$55',
      durationMinutes: 60,
      templateKey: 'luster_manicure',
    },
    {
      id: FOREIGN_SERVICE_ID,
      salonId: OTHER_SALON_ID,
      name: 'Foreign Service',
      category: 'manicure',
      price: 8000,
      durationMinutes: 45,
    },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /api/salon/services/[id]', () => {
  it('rejects unauthenticated callers and leaves the row unchanged', async () => {
    const response = await PATCH(...patchRequest(SERVICE_ID, VALID_BODY));

    expect(response.status).toBe(401);

    const row = await getServiceRow(SERVICE_ID);

    expect(row?.price).toBe(4500);
    expect(row?.priceDisplayText).toBe('$75+');
  });

  it('returns 404 for a service belonging to another salon (tenant isolation)', async () => {
    holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };

    const response = await PATCH(...patchRequest(FOREIGN_SERVICE_ID, VALID_BODY));

    expect(response.status).toBe(404);

    const foreign = await getServiceRow(FOREIGN_SERVICE_ID);

    expect(foreign?.price).toBe(8000);
    expect(foreign?.name).toBe('Foreign Service');
  });

  it('returns 400 on invalid payloads and leaves the row unchanged', async () => {
    holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };

    const negativePrice = await PATCH(
      ...patchRequest(SERVICE_ID, { ...VALID_BODY, price: -1 }),
    );

    expect(negativePrice.status).toBe(400);

    const fractionalCents = await PATCH(
      ...patchRequest(SERVICE_ID, { ...VALID_BODY, price: 55.5 }),
    );

    expect(fractionalCents.status).toBe(400);

    const row = await getServiceRow(SERVICE_ID);

    expect(row?.price).toBe(4500);
    expect(row?.priceDisplayText).toBe('$75+');
    expect(row?.introPriceLabel).toBe('$55');
  });

  it('persists the $55 repair (price, cleared display text, relabeled badge) and bumps updatedAt', async () => {
    holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
    const before = await getServiceRow(SERVICE_ID);

    const response = await PATCH(...patchRequest(SERVICE_ID, VALID_BODY));

    expect(response.status).toBe(200);

    const payload = await response.json();

    expect(payload.data.service).toMatchObject({
      id: SERVICE_ID,
      price: 5500,
      priceDisplayText: null,
      isIntroPrice: true,
      introPriceLabel: 'Intro price',
      isActive: true,
    });

    const row = await getServiceRow(SERVICE_ID);

    expect(row).toMatchObject({
      price: 5500,
      priceDisplayText: null,
      isIntroPrice: true,
      introPriceLabel: 'Intro price',
    });
    expect(row!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it('deactivates without touching pricing fields', async () => {
    holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };

    const response = await PATCH(...patchRequest(SERVICE_ID, {
      ...VALID_BODY,
      price: 4500,
      priceDisplayText: '$75+',
      introPriceLabel: '$55',
      isActive: false,
    }));

    expect(response.status).toBe(200);

    const row = await getServiceRow(SERVICE_ID);

    expect(row).toMatchObject({
      isActive: false,
      price: 4500,
      priceDisplayText: '$75+',
      introPriceLabel: '$55',
    });
  });
});
