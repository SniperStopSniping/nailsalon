/**
 * POST /api/salon/catalog-preview — authenticated, salon-scoped. The
 * LOAD-BEARING guarantee (hard constraint #4 in the PR6 brief: "no second
 * resolver") is proven directly here: the route's own output is compared,
 * field for field, against calling `resolveCatalogSelectionForSalon` /
 * `resolvePublicCatalogSnapshot` OURSELVES against the identical rows —
 * if the route ever grew a parallel price/duration calculation, this test
 * would catch the divergence.
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
  authenticated: true,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  getAdminSession: vi.fn(async () => holder.authenticated ? { id: 'preview-admin' } : null),
  requireAdminSalon: vi.fn(async () => {
    if (holder.adminSalon) {
      return { salon: holder.adminSalon, error: null };
    }
    return { salon: null, error: new Response(null, { status: 401 }) };
  }),
}));

/* eslint-disable import/first */
import { resolveCatalogSelectionForSalon, resolvePublicCatalogSnapshot } from '@/libs/catalogResolver.server';
import {
  makeFixtureAddOn,
  makeFixtureBinding,
  makeFixtureService,
} from '@/libs/catalogResolverFixtures';

import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_catalog_preview_route';
const SALON_SLUG = 'catalog-preview-route-salon';
const SERVICE_ID = 'svc_preview_route';
const ADD_ON_ID = 'addon_preview_route';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/salon/catalog-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({ id: SALON_ID, name: 'Catalog Preview Route Salon', slug: SALON_SLUG, settings: { booking: { currency: 'USD' } } });
  await db.insert(schema.serviceSchema).values([makeFixtureService({ id: SERVICE_ID, salonId: SALON_ID })]);
  await db.insert(schema.addOnSchema).values([makeFixtureAddOn({ id: ADD_ON_ID, salonId: SALON_ID })]);
  await db.insert(schema.serviceAddOnSchema).values([makeFixtureBinding({ id: 'sao_preview_route', salonId: SALON_ID, serviceId: SERVICE_ID, addOnId: ADD_ON_ID })]);
}, 60_000);

beforeEach(() => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  holder.authenticated = true;
});

afterAll(async () => {
  await client.close();
});

describe('POST /api/salon/catalog-preview', () => {
  it('rejects unauthenticated callers', async () => {
    holder.adminSalon = null;
    holder.authenticated = false;
    const response = await POST(postRequest({ salonSlug: SALON_SLUG, serviceId: SERVICE_ID, selectedAddOns: [] }));

    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated input before opening the body stream', async () => {
    holder.adminSalon = null;
    holder.authenticated = false;
    const request = postRequest({ selectedAddOns: ['invalid'] });
    const read = vi.spyOn(request.body!, 'getReader');

    expect((await POST(request)).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it('checks salon access before validating malformed selection collections', async () => {
    holder.adminSalon = null;
    const response = await POST(postRequest({ salonSlug: 'other-salon', selectedAddOns: 'invalid' }));

    expect(response.status).toBe(401);
  });

  it('bounds authenticated JSON before catalog resolution or validation', async () => {
    const response = await POST(postRequest({ salonSlug: SALON_SLUG, serviceId: SERVICE_ID, padding: 'x'.repeat(30_000) }));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'REQUEST_TOO_LARGE' } });
  });

  it('matches resolveCatalogSelectionForSalon exactly — price, duration, and violations', async () => {
    const selection = { serviceId: SERVICE_ID, technicianId: null, selectedAddOns: [{ addOnId: ADD_ON_ID, quantity: 2 }] };

    const response = await POST(postRequest({ salonSlug: SALON_SLUG, ...selection }));
    const body = await response.json();

    const snapshotResult = await resolvePublicCatalogSnapshot({ salonId: SALON_ID, requestedSource: 'live' });
    if (!snapshotResult.ok) {
      throw new Error('expected snapshot ok:true');
    }
    const directResult = await resolveCatalogSelectionForSalon({ salonId: SALON_ID, snapshot: snapshotResult.snapshot, selection });
    if (!directResult.ok) {
      throw new Error('expected resolution ok:true');
    }

    expect(response.status).toBe(200);
    expect(body.data.ok).toBe(true);
    expect(body.data.basePriceCents).toBe(directResult.selection.basePriceCents);
    expect(body.data.baseDurationMinutes).toBe(directResult.selection.baseDurationMinutes);
    expect(body.data.subtotalCents).toBe(directResult.selection.subtotalCents);
    expect(body.data.totalDurationMinutes).toBe(directResult.selection.totalDurationMinutes);
    expect(body.data.violations).toEqual(directResult.selection.violations);
    expect(body.data.blocksContinue).toBe(directResult.selection.blocksContinue);
    expect(body.data.addOns).toEqual(directResult.selection.addOns.map(line => ({
      addOnId: line.addOnId,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
      unitDurationMinutes: line.unitDurationMinutes,
      lineDurationMinutes: line.lineDurationMinutes,
      autoAdded: line.autoAdded,
    })));

    // Cross-check against the fixture's own known values too, not just
    // "whatever the direct call returned" — belt and suspenders.
    expect(body.data.basePriceCents).toBe(4500);
    expect(body.data.addOns[0]).toMatchObject({ addOnId: ADD_ON_ID, quantity: 2, unitPriceCents: 1000, lineTotalCents: 2000 });
  });

  it('reports ok:false for a selection referencing an unknown service, never a guessed price', async () => {
    const response = await POST(postRequest({ salonSlug: SALON_SLUG, serviceId: 'svc_does_not_exist', selectedAddOns: [] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.ok).toBe(false);
    expect(body.data).not.toHaveProperty('basePriceCents');
  });

  it('rejects an invalid payload', async () => {
    const response = await POST(postRequest({ salonSlug: SALON_SLUG }));

    expect(response.status).toBe(400);
  });
});
