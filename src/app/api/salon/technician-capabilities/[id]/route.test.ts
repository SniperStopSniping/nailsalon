/** DELETE /api/salon/technician-capabilities/[id] — unassign a capability from a technician. */
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
import { DELETE } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_tc_id_route';
const SALON_SLUG = 'tc-id-route-salon';
const OTHER_SALON_ID = 'salon_tc_id_route_other';
const TECH_ID = 'tech_tc_id_route';
const CAPABILITY_ID = 'cap_tc_id_route';
const FOREIGN_TECH_ID = 'tech_tc_id_route_foreign';
const FOREIGN_CAPABILITY_ID = 'cap_tc_id_route_foreign';
const ASSIGNMENT_ID = 'tc_id_route_target';
const FOREIGN_ASSIGNMENT_ID = 'tc_id_route_foreign';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function deleteRequest(id: string, salonSlug: string): [Request, { params: { id: string } }] {
  return [
    new Request(`http://localhost/api/salon/technician-capabilities/${id}?salonSlug=${salonSlug}`, { method: 'DELETE' }),
    { params: { id } },
  ];
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'TC Id Route Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'tc-id-route-other', settings: {} },
  ]);
  await db.insert(schema.technicianSchema).values([
    { id: TECH_ID, salonId: SALON_ID, name: 'Alice' },
    { id: FOREIGN_TECH_ID, salonId: OTHER_SALON_ID, name: 'Foreign Tech' },
  ]);
  await db.insert(schema.capabilitySchema).values([
    { id: CAPABILITY_ID, salonId: SALON_ID, slug: 'ombre', name: 'Ombre' },
    { id: FOREIGN_CAPABILITY_ID, salonId: OTHER_SALON_ID, slug: 'foreign', name: 'Foreign' },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.technicianCapabilitySchema);
  await db.insert(schema.technicianCapabilitySchema).values([
    { id: ASSIGNMENT_ID, salonId: SALON_ID, technicianId: TECH_ID, capabilityId: CAPABILITY_ID },
    { id: FOREIGN_ASSIGNMENT_ID, salonId: OTHER_SALON_ID, technicianId: FOREIGN_TECH_ID, capabilityId: FOREIGN_CAPABILITY_ID },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('DELETE /api/salon/technician-capabilities/[id]', () => {
  it('rejects unauthenticated callers', async () => {
    holder.adminSalon = null;
    const response = await DELETE(...deleteRequest(ASSIGNMENT_ID, SALON_SLUG));

    expect(response.status).toBe(401);
  });

  it('unassigns the capability', async () => {
    const response = await DELETE(...deleteRequest(ASSIGNMENT_ID, SALON_SLUG));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.deleted).toBe(true);

    const rows = await db.select().from(schema.technicianCapabilitySchema);

    expect(rows.map(r => r.id)).not.toContain(ASSIGNMENT_ID);
  });

  it('cannot unassign another salon’s assignment row', async () => {
    const response = await DELETE(...deleteRequest(FOREIGN_ASSIGNMENT_ID, SALON_SLUG));

    expect(response.status).toBe(404);
  });
});
