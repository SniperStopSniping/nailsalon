/**
 * GET/POST /api/salon/capabilities — the FIRST writer `capability` has ever
 * had (migration 0073 created it empty and dark).
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
import { GET, POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_capability_route';
const SALON_SLUG = 'capability-route-salon';
const OTHER_SALON_ID = 'salon_capability_route_other';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function getRequest(salonSlug: string): Request {
  return new Request(`http://localhost/api/salon/capabilities?salonSlug=${salonSlug}`);
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/salon/capabilities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { salonSlug: SALON_SLUG, name: 'Russian Manicure' };

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Capability Route Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'capability-route-other', settings: {} },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.capabilitySchema);
});

afterAll(async () => {
  await client.close();
});

describe('GET /api/salon/capabilities', () => {
  it('rejects unauthenticated callers', async () => {
    holder.adminSalon = null;
    const response = await GET(getRequest(SALON_SLUG));

    expect(response.status).toBe(401);
  });

  it('never returns another salon’s capabilities', async () => {
    await db.insert(schema.capabilitySchema).values({ id: 'cap_foreign', salonId: OTHER_SALON_ID, slug: 'foreign', name: 'Foreign' });
    const response = await GET(getRequest(SALON_SLUG));
    const body = await response.json();

    expect(body.data.capabilities).toHaveLength(0);
  });
});

describe('POST /api/salon/capabilities', () => {
  it('rejects unauthenticated callers and creates nothing', async () => {
    holder.adminSalon = null;
    const response = await POST(postRequest(VALID_BODY));
    const rows = await db.select().from(schema.capabilitySchema);

    expect(response.status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it('creates a capability scoped to the calling salon', async () => {
    const response = await POST(postRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.capability).toMatchObject({ name: 'Russian Manicure', isActive: true });

    const [row] = await db.select().from(schema.capabilitySchema).where(eq(schema.capabilitySchema.id, body.data.capability.id));

    expect(row!.salonId).toBe(SALON_ID);
  });

  it('rejects a blank name', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, name: '  ' }));

    expect(response.status).toBe(400);
  });
});
