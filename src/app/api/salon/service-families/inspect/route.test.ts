/**
 * POST /api/salon/service-families/inspect — the "what would happen"
 * dry-run. Load-bearing guarantees: it NEVER writes, it reports the exact
 * same changes the commit endpoint would apply for the identical request,
 * and it surfaces the non-fatal warnings the brief calls out (category /
 * booking-category disagreement, staff-assignment effects).
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
import { POST as commit } from '../route';
import { POST as inspect } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_family_inspect';
const SALON_SLUG = 'family-inspect-salon';
const PARENT_ID = 'svc_family_inspect_parent';
const CHILD_ID = 'svc_family_inspect_child';
const MISMATCHED_CHILD_ID = 'svc_family_inspect_mismatch_child';
const TECH_A = 'tech_family_inspect_a';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
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

  await db.insert(schema.salonSchema).values({ id: SALON_ID, name: 'Family Inspect Salon', slug: SALON_SLUG, settings: {} });
  await db.insert(schema.technicianSchema).values({ id: TECH_A, salonId: SALON_ID, name: 'Alice', isActive: true });
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.technicianServicesSchema);
  await db.delete(schema.serviceSchema);
  await db.insert(schema.serviceSchema).values([
    { id: PARENT_ID, salonId: SALON_ID, name: 'Gel Manicure', category: 'manicure', bookingCategory: 'manicure', price: 4500, durationMinutes: 60, isActive: true },
    { id: CHILD_ID, salonId: SALON_ID, name: 'Gel Manicure — Short', category: 'manicure', bookingCategory: 'manicure', price: 4000, durationMinutes: 50, isActive: true },
    { id: MISMATCHED_CHILD_ID, salonId: SALON_ID, name: 'Gel Pedicure Add-on', category: 'pedicure', bookingCategory: 'pedicure', price: 3000, durationMinutes: 40, isActive: true },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('POST /api/salon/service-families/inspect', () => {
  it('rejects unauthenticated callers', async () => {
    holder.adminSalon = null;
    const response = await inspect(postRequest('http://localhost/api/salon/service-families/inspect', {
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
      variantKind: 'length',
    }));

    expect(response.status).toBe(401);
  });

  it('never writes — the service rows are unchanged after inspecting', async () => {
    await inspect(postRequest('http://localhost/api/salon/service-families/inspect', {
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
      variantKind: 'length',
    }));

    const [childRow] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, CHILD_ID));
    const [parentRow] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, PARENT_ID));

    expect(childRow).toMatchObject({ parentServiceId: null, variantLabel: null });
    expect(parentRow!.variantKind).toBeNull();
  });

  it('reports the exact same changes the commit endpoint goes on to apply', async () => {
    const body = { salonSlug: SALON_SLUG, operation: 'attach', parentServiceId: PARENT_ID, childServiceId: CHILD_ID, variantLabel: 'Short', variantKind: 'length' };

    const inspectResponse = await inspect(postRequest('http://localhost/api/salon/service-families/inspect', body));
    const inspectBody = await inspectResponse.json();

    const commitResponse = await commit(postRequest('http://localhost/api/salon/service-families', body));
    const commitBody = await commitResponse.json();

    expect(inspectResponse.status).toBe(200);
    expect(commitResponse.status).toBe(200);
    expect(inspectBody.data.changes).toEqual(commitBody.data.changes);
  });

  it('reports a category/booking-category mismatch warning', async () => {
    const response = await inspect(postRequest('http://localhost/api/salon/service-families/inspect', {
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: MISMATCHED_CHILD_ID,
      variantLabel: 'Pedi add-on',
      variantKind: 'length',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);

    const codes = body.data.warnings.map((w: { code: string }) => w.code);

    expect(codes).toContain('category_mismatch');
    expect(codes).toContain('booking_category_mismatch');
  });

  it('reports a staff-assignment mismatch warning when parent and child have different technicians', async () => {
    await db.insert(schema.technicianServicesSchema).values({ technicianId: TECH_A, serviceId: PARENT_ID, enabled: true });

    const response = await inspect(postRequest('http://localhost/api/salon/service-families/inspect', {
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
      variantKind: 'length',
    }));
    const body = await response.json();

    const codes = body.data.warnings.map((w: { code: string }) => w.code);

    expect(codes).toContain('staff_assignment_mismatch');
  });

  it('surfaces the same hard-invariant rejection as commit, for the same invalid request', async () => {
    const response = await inspect(postRequest('http://localhost/api/salon/service-families/inspect', {
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: PARENT_ID,
      variantLabel: 'x',
      variantKind: 'length',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('SELF_PARENT');
  });
});
