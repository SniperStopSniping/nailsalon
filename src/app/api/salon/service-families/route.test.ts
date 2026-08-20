/**
 * POST /api/salon/service-families — the FIRST write path for
 * `service.parentServiceId`/`variantLabel`/`variantKind` (migration 0072
 * created them nullable and dark). Every invariant the brief calls out is
 * exercised here: legacy services are never touched implicitly, no
 * synthetic family is ever created, no grandchildren, one axis per family,
 * no self-parent, tenant scoping, and "an active child needs an active
 * parent".
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
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_family_commit';
const SALON_SLUG = 'family-commit-salon';
const OTHER_SALON_ID = 'salon_family_commit_other';

const PARENT_ID = 'svc_family_parent';
const CHILD_ID = 'svc_family_child';
const CHILD_2_ID = 'svc_family_child_2';
const LEGACY_ID = 'svc_family_legacy';
const GRANDPARENT_CANDIDATE_ID = 'svc_family_grandparent_candidate';
const ALREADY_PARENT_ID = 'svc_family_already_parent';
const ALREADY_PARENTS_CHILD_ID = 'svc_family_already_parents_child';
const FOREIGN_SERVICE_ID = 'svc_family_foreign';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/salon/service-families', {
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

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Family Commit Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'family-commit-other', settings: {} },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.serviceSchema);
  await db.insert(schema.serviceSchema).values([
    { id: PARENT_ID, salonId: SALON_ID, name: 'Gel Manicure', category: 'manicure', price: 4500, durationMinutes: 60, isActive: true },
    { id: CHILD_ID, salonId: SALON_ID, name: 'Gel Manicure — Short', category: 'manicure', price: 4000, durationMinutes: 50, isActive: true },
    { id: CHILD_2_ID, salonId: SALON_ID, name: 'Gel Manicure — XL', category: 'manicure', price: 5500, durationMinutes: 70, isActive: true },
    { id: LEGACY_ID, salonId: SALON_ID, name: 'Legacy Pedicure', category: 'pedicure', price: 5000, durationMinutes: 45, isActive: true },
    { id: ALREADY_PARENT_ID, salonId: SALON_ID, name: 'Existing Family Parent', category: 'manicure', price: 100, durationMinutes: 10, variantKind: 'shape', isActive: true },
    { id: ALREADY_PARENTS_CHILD_ID, salonId: SALON_ID, name: 'Existing Family Child', category: 'manicure', price: 100, durationMinutes: 10, parentServiceId: ALREADY_PARENT_ID, variantLabel: 'round', isActive: true },
    // A service that is ITSELF already a variant (child) of a THIRD,
    // unrelated family — used only to prove "no grandchildren" rejects
    // attaching under a parent that is already someone else's child.
    // Deliberately NOT a child of PARENT_ID, so PARENT_ID stays a pristine
    // childless service for the "establishes a new family" tests.
    { id: GRANDPARENT_CANDIDATE_ID, salonId: SALON_ID, name: 'Already a Child', category: 'manicure', price: 100, durationMinutes: 10, parentServiceId: ALREADY_PARENT_ID, variantLabel: 'stray', isActive: false },
    { id: FOREIGN_SERVICE_ID, salonId: OTHER_SALON_ID, name: 'Foreign', category: 'manicure', price: 100, durationMinutes: 10, isActive: true },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('POST /api/salon/service-families — attach', () => {
  it('rejects unauthenticated callers and writes nothing', async () => {
    holder.adminSalon = null;
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
      variantKind: 'length',
    }));

    expect(response.status).toBe(401);

    const [row] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, CHILD_ID));

    expect(row!.parentServiceId).toBeNull();
  });

  it('establishes a new family: sets the child link/label and the parent axis', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
      variantKind: 'length',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.child).toMatchObject({ id: CHILD_ID, parentServiceId: PARENT_ID, variantLabel: 'Short' });
    expect(body.data.parent).toMatchObject({ id: PARENT_ID, variantKind: 'length' });

    const [childRow] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, CHILD_ID));
    const [parentRow] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, PARENT_ID));

    expect(childRow).toMatchObject({ parentServiceId: PARENT_ID, variantLabel: 'Short', variantKind: null });
    expect(parentRow!.variantKind).toBe('length');
  });

  it('a second attach to the same family may omit variantKind and inherits the existing axis', async () => {
    await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
      variantKind: 'length',
    }));

    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_2_ID,
      variantLabel: 'XL',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.child).toMatchObject({ parentServiceId: PARENT_ID, variantLabel: 'XL' });

    const [parentRow] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, PARENT_ID));

    expect(parentRow!.variantKind).toBe('length');
  });

  it('rejects a variantKind that disagrees with the family’s existing axis (one axis per family)', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: ALREADY_PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Round',
      variantKind: 'length',
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('VARIANT_KIND_MISMATCH');
  });

  it('requires variantKind when establishing a brand-new family', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VARIANT_KIND_REQUIRED');
  });

  it('requires a non-blank variantLabel', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: '   ',
      variantKind: 'length',
    }));

    expect(response.status).toBe(400);
  });

  it('rejects a service becoming its own parent', async () => {
    const response = await POST(postRequest({
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

  it('rejects attaching to a parent that is itself already a variant (no grandchildren)', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: GRANDPARENT_CANDIDATE_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'x',
      variantKind: 'length',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('PARENT_IS_ALREADY_A_VARIANT');
  });

  it('rejects attaching a service that already has its own children (no grandchildren)', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: ALREADY_PARENT_ID,
      variantLabel: 'x',
      variantKind: 'length',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('GRANDCHILD_NOT_ALLOWED');
  });

  it('rejects an active child under an inactive parent', async () => {
    await db.update(schema.serviceSchema).set({ isActive: false }).where(eq(schema.serviceSchema.id, PARENT_ID));

    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
      variantKind: 'length',
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('PARENT_MUST_BE_ACTIVE');
  });

  it('rejects a cross-salon parent and a cross-salon child', async () => {
    const crossParent = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: FOREIGN_SERVICE_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'x',
      variantKind: 'length',
    }));

    expect(crossParent.status).toBe(404);

    const crossChild = await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: FOREIGN_SERVICE_ID,
      variantLabel: 'x',
      variantKind: 'length',
    }));

    expect(crossChild.status).toBe(404);
  });

  it('never touches a legacy service that was not named in the request', async () => {
    await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
      variantKind: 'length',
    }));

    const [legacyRow] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, LEGACY_ID));

    expect(legacyRow).toMatchObject({ parentServiceId: null, variantLabel: null, variantKind: null, selectionMode: null, confirmationMode: null });
  });
});

describe('POST /api/salon/service-families — detach', () => {
  it('restores a variant to standalone', async () => {
    await POST(postRequest({
      salonSlug: SALON_SLUG,
      operation: 'attach',
      parentServiceId: PARENT_ID,
      childServiceId: CHILD_ID,
      variantLabel: 'Short',
      variantKind: 'length',
    }));

    const response = await POST(postRequest({ salonSlug: SALON_SLUG, operation: 'detach', childServiceId: CHILD_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.child).toMatchObject({ parentServiceId: null, variantLabel: null });
  });

  it('rejects detaching a service that is not currently a variant', async () => {
    const response = await POST(postRequest({ salonSlug: SALON_SLUG, operation: 'detach', childServiceId: LEGACY_ID }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('NOT_A_VARIANT');
  });
});
