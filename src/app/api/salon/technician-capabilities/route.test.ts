/**
 * GET/POST /api/salon/technician-capabilities — the FIRST writer
 * `technician_capability` has ever had. Load-bearing: BOTH sides of an
 * assignment must belong to the calling salon (validated independently of
 * the composite foreign keys), and a duplicate assignment is rejected with
 * a readable reason rather than a raw unique-constraint error.
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
import { GET, POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_tc_route';
const SALON_SLUG = 'tc-route-salon';
const OTHER_SALON_ID = 'salon_tc_route_other';
const TECH_ID = 'tech_tc_route';
const FOREIGN_TECH_ID = 'tech_tc_route_foreign';
const CAPABILITY_ID = 'cap_tc_route';
const FOREIGN_CAPABILITY_ID = 'cap_tc_route_foreign';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function getRequest(salonSlug: string): Request {
  return new Request(`http://localhost/api/salon/technician-capabilities?salonSlug=${salonSlug}`);
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/salon/technician-capabilities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { salonSlug: SALON_SLUG, technicianId: TECH_ID, capabilityId: CAPABILITY_ID };

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'TC Route Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'tc-route-other', settings: {} },
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
});

afterAll(async () => {
  await client.close();
});

describe('GET /api/salon/technician-capabilities', () => {
  it('rejects unauthenticated callers', async () => {
    holder.adminSalon = null;
    const response = await GET(getRequest(SALON_SLUG));

    expect(response.status).toBe(401);
  });
});

describe('POST /api/salon/technician-capabilities', () => {
  it('rejects unauthenticated callers and creates nothing', async () => {
    holder.adminSalon = null;
    const response = await POST(postRequest(VALID_BODY));
    const rows = await db.select().from(schema.technicianCapabilitySchema);

    expect(response.status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it('assigns a capability to a technician, both same-salon', async () => {
    const response = await POST(postRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.assignment).toMatchObject({ technicianId: TECH_ID, capabilityId: CAPABILITY_ID });
  });

  it('rejects a technician from another salon', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, technicianId: FOREIGN_TECH_ID }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('TECHNICIAN_NOT_FOUND');
  });

  it('rejects a capability from another salon', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, capabilityId: FOREIGN_CAPABILITY_ID }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('CAPABILITY_NOT_FOUND');
  });

  it('rejects a duplicate assignment with a readable error, not a raw constraint failure', async () => {
    await POST(postRequest(VALID_BODY));
    const response = await POST(postRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('ALREADY_ASSIGNED');

    const rows = await db.select().from(schema.technicianCapabilitySchema);

    expect(rows).toHaveLength(1);
  });
});
