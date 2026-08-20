/**
 * PATCH/DELETE /api/salon/capabilities/[id]. Load-bearing DELETE guarantee:
 * a capability still assigned to a technician, or still required by a
 * `catalog_rule`, is never silently unassigned/detached — deletion is
 * blocked instead.
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

const SALON_ID = 'salon_capability_id_route';
const SALON_SLUG = 'capability-id-route-salon';
const OTHER_SALON_ID = 'salon_capability_id_route_other';
const CAPABILITY_ID = 'cap_id_route_target';
const FOREIGN_CAPABILITY_ID = 'cap_id_route_foreign';
const TECH_ID = 'tech_id_route';
const SERVICE_ID = 'svc_id_route';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function patchRequest(id: string, body: unknown): [Request, { params: { id: string } }] {
  return [
    new Request(`http://localhost/api/salon/capabilities/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  ];
}

function deleteRequest(id: string, salonSlug: string): [Request, { params: { id: string } }] {
  return [
    new Request(`http://localhost/api/salon/capabilities/${id}?salonSlug=${salonSlug}`, { method: 'DELETE' }),
    { params: { id } },
  ];
}

const VALID_BODY = { salonSlug: SALON_SLUG, name: 'Ombre' };

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Capability Id Route Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'capability-id-route-other', settings: {} },
  ]);
  await db.insert(schema.technicianSchema).values({ id: TECH_ID, salonId: SALON_ID, name: 'Alice' });
  await db.insert(schema.serviceSchema).values({ id: SERVICE_ID, salonId: SALON_ID, name: 'Gel', category: 'manicure', price: 100, durationMinutes: 30 });
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.catalogRuleSchema);
  await db.delete(schema.technicianCapabilitySchema);
  await db.delete(schema.capabilitySchema);
  await db.insert(schema.capabilitySchema).values([
    { id: CAPABILITY_ID, salonId: SALON_ID, slug: 'target', name: 'Target' },
    { id: FOREIGN_CAPABILITY_ID, salonId: OTHER_SALON_ID, slug: 'foreign', name: 'Foreign' },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /api/salon/capabilities/[id]', () => {
  it('rejects unauthenticated callers and leaves the row unchanged', async () => {
    holder.adminSalon = null;
    const response = await PATCH(...patchRequest(CAPABILITY_ID, { ...VALID_BODY, name: 'Changed' }));
    const [row] = await db.select().from(schema.capabilitySchema).where(eq(schema.capabilitySchema.id, CAPABILITY_ID));

    expect(response.status).toBe(401);
    expect(row!.name).toBe('Target');
  });

  it('updates name, description, and active state', async () => {
    const response = await PATCH(...patchRequest(CAPABILITY_ID, { ...VALID_BODY, description: 'Long-lasting', isActive: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.capability).toMatchObject({ name: 'Ombre', description: 'Long-lasting', isActive: false });
  });

  it('cannot edit another salon’s capability', async () => {
    const response = await PATCH(...patchRequest(FOREIGN_CAPABILITY_ID, { ...VALID_BODY, name: 'Hijacked' }));

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/salon/capabilities/[id]', () => {
  it('deletes an unassigned capability', async () => {
    const response = await DELETE(...deleteRequest(CAPABILITY_ID, SALON_SLUG));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  it('refuses to delete a capability still assigned to a technician', async () => {
    await db.insert(schema.technicianCapabilitySchema).values({ id: 'tc_block', salonId: SALON_ID, technicianId: TECH_ID, capabilityId: CAPABILITY_ID });

    const response = await DELETE(...deleteRequest(CAPABILITY_ID, SALON_SLUG));
    const body = await response.json();
    const rows = await db.select().from(schema.capabilitySchema).where(eq(schema.capabilitySchema.id, CAPABILITY_ID));

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CAPABILITY_HAS_ASSIGNMENTS');
    expect(rows).toHaveLength(1);
  });

  it('refuses to delete a capability still required by a rule', async () => {
    await db.insert(schema.catalogRuleSchema).values({
      id: 'rule_block',
      salonId: SALON_ID,
      ruleType: 'requires_capability',
      subjectServiceId: SERVICE_ID,
      capabilityId: CAPABILITY_ID,
    });

    const response = await DELETE(...deleteRequest(CAPABILITY_ID, SALON_SLUG));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CAPABILITY_IN_USE_BY_RULE');
  });

  it('cannot delete another salon’s capability', async () => {
    const response = await DELETE(...deleteRequest(FOREIGN_CAPABILITY_ID, SALON_SLUG));

    expect(response.status).toBe(404);
  });
});
