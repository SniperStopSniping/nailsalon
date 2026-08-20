/**
 * PATCH /api/salon/services/[id] — the NEW `confirmationMode` write and the
 * "an active variant needs an active parent" guard this PR adds.
 * `route.test.ts` (unmodified) covers every pre-existing PATCH guarantee.
 *
 * Load-bearing: NULL is never auto-converted (a legacy service PATCHed
 * without `confirmationMode` stays NULL), and `'consultation'` — a real
 * value at the DATABASE layer (migration 0072's own CHECK) — is rejected by
 * this route as not-yet-available (deferred to L7).
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

const SALON_ID = 'salon_svc_confirmation';
const SALON_SLUG = 'svc-confirmation-salon';
const PARENT_ID = 'svc_confirmation_parent';
const CHILD_ID = 'svc_confirmation_child';
const LEGACY_ID = 'svc_confirmation_legacy';

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

const BASE_BODY = {
  salonSlug: SALON_SLUG,
  name: 'Gel Manicure',
  price: 4500,
  durationMinutes: 60,
  category: 'manicure',
  isActive: true,
};

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({ id: SALON_ID, name: 'Confirmation Salon', slug: SALON_SLUG, settings: {} });
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.serviceSchema);
  await db.insert(schema.serviceSchema).values([
    { id: LEGACY_ID, salonId: SALON_ID, name: 'Legacy Service', category: 'manicure', price: 4000, durationMinutes: 45 },
    { id: PARENT_ID, salonId: SALON_ID, name: 'Gel Manicure', category: 'manicure', price: 4500, durationMinutes: 60, variantKind: 'length', isActive: true },
    { id: CHILD_ID, salonId: SALON_ID, name: 'Gel Manicure — Long', category: 'manicure', price: 5000, durationMinutes: 70, parentServiceId: PARENT_ID, variantLabel: 'Long', isActive: true },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /api/salon/services/[id] — confirmationMode', () => {
  it('leaves confirmationMode NULL when omitted (never auto-converted)', async () => {
    await PATCH(...patchRequest(LEGACY_ID, BASE_BODY));
    const [row] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, LEGACY_ID));

    expect(row!.confirmationMode).toBeNull();
  });

  it('writes instant', async () => {
    const response = await PATCH(...patchRequest(LEGACY_ID, { ...BASE_BODY, confirmationMode: 'instant' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.service.confirmationMode).toBe('instant');
  });

  it('writes request_approval', async () => {
    const response = await PATCH(...patchRequest(LEGACY_ID, { ...BASE_BODY, confirmationMode: 'request_approval' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.service.confirmationMode).toBe('request_approval');
  });

  it('rejects consultation as not-yet-available and writes nothing', async () => {
    const response = await PATCH(...patchRequest(LEGACY_ID, { ...BASE_BODY, confirmationMode: 'consultation' }));
    const body = await response.json();
    const [row] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, LEGACY_ID));

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('CONFIRMATION_MODE_NOT_AVAILABLE');
    expect(row!.confirmationMode).toBeNull();
  });

  it('clears a previously-set mode back to NULL on explicit null', async () => {
    await PATCH(...patchRequest(LEGACY_ID, { ...BASE_BODY, confirmationMode: 'instant' }));
    const response = await PATCH(...patchRequest(LEGACY_ID, { ...BASE_BODY, confirmationMode: null }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.service.confirmationMode).toBeNull();
  });
});

describe('PATCH /api/salon/services/[id] — parent must stay active while a publicly bookable child exists', () => {
  it('blocks deactivating a parent that has an active child', async () => {
    const response = await PATCH(...patchRequest(PARENT_ID, { ...BASE_BODY, isActive: false }));
    const body = await response.json();
    const [row] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, PARENT_ID));

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('PARENT_HAS_ACTIVE_CHILDREN');
    expect(row!.isActive).toBe(true);
  });

  it('allows deactivating a parent once its child is already inactive', async () => {
    await db.update(schema.serviceSchema).set({ isActive: false }).where(eq(schema.serviceSchema.id, CHILD_ID));

    const response = await PATCH(...patchRequest(PARENT_ID, { ...BASE_BODY, isActive: false }));

    expect(response.status).toBe(200);
  });

  it('is a no-op for a legacy service with no children', async () => {
    const response = await PATCH(...patchRequest(LEGACY_ID, { ...BASE_BODY, isActive: false }));

    expect(response.status).toBe(200);
  });

  it('blocks reactivating a child whose parent is inactive — the same invariant from the other side', async () => {
    // Guarding only the parent-deactivation direction left this trivially
    // reachable with three ordinary, individually-legal edits: deactivate the
    // child, deactivate the now-childless parent, reactivate the child. That
    // ended with an active variant stranded under an inactive family, and no
    // DB CHECK backs the invariant, so the application is the only guard.
    await PATCH(...patchRequest(CHILD_ID, { ...BASE_BODY, isActive: false }));
    await PATCH(...patchRequest(PARENT_ID, { ...BASE_BODY, isActive: false }));

    const response = await PATCH(...patchRequest(CHILD_ID, { ...BASE_BODY, isActive: true }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('PARENT_NOT_ACTIVE');

    const [child] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, CHILD_ID));

    expect(child!.isActive).toBe(false);
  });

  it('allows reactivating a child once its parent is active again', async () => {
    await PATCH(...patchRequest(CHILD_ID, { ...BASE_BODY, isActive: false }));
    await PATCH(...patchRequest(PARENT_ID, { ...BASE_BODY, isActive: false }));
    await PATCH(...patchRequest(PARENT_ID, { ...BASE_BODY, isActive: true }));

    const response = await PATCH(...patchRequest(CHILD_ID, { ...BASE_BODY, isActive: true }));

    expect(response.status).toBe(200);
  });

  it('never applies the parent-active check to a legacy service with no parent', async () => {
    await PATCH(...patchRequest(LEGACY_ID, { ...BASE_BODY, isActive: false }));

    const response = await PATCH(...patchRequest(LEGACY_ID, { ...BASE_BODY, isActive: true }));

    expect(response.status).toBe(200);
  });
});
