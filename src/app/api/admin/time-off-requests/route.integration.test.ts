/**
 * Integration cover for the time-off inbox against a real DATE column.
 *
 * The P1 regression (AG-security-tenancy-01 / AG-w2-more-tools-01) could not be
 * caught by a mocked unit test: `time_off_request.start_date` is DATE in the
 * shipped migration (0027) while the model declared it `timestamp`, so the
 * non-timezone mapper produced an Invalid Date and every read 500'd. These
 * tests run the routes against a migrated Postgres (PGlite), which is the only
 * place the column type and the Drizzle mapper meet.
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
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const requireAdminSalonFromRequest = vi.hoisted(() => vi.fn());

// The list route resolves the salon from the request (so `?salonSlug=` is
// honoured); the decision route still resolves it from the active selection.
// Both resolve to the same salon here.
vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalonFromRequest,
  requireActiveAdminSalon: requireAdminSalonFromRequest,
}));

/* eslint-disable import/first */
import { PATCH } from './[id]/route';
import { GET } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_audit_no5';
const TECH_ID = 'tech_tiffany';
const ADMIN_ID = 'admin_audit_owner';
const REQUEST_ID = 'tor_audit_1';
const START_DATE = '2026-09-17';
const END_DATE = '2026-09-18';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Nail Salon No.5',
    slug: 'nail-salon-no5-timeoff',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Tiffany',
  });
  await db.insert(schema.adminUserSchema).values({
    id: ADMIN_ID,
    name: 'Audit Owner',
    email: 'audit-owner-timeoff@example.test',
  });
}, 120_000);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  await db.delete(schema.notificationSchema);
  await db.delete(schema.technicianTimeOffSchema);
  await db.delete(schema.timeOffRequestSchema);

  await db.insert(schema.timeOffRequestSchema).values({
    id: REQUEST_ID,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    startDate: START_DATE,
    endDate: END_DATE,
    note: 'AUDIT-0905 family trip',
    status: 'PENDING',
  });

  requireAdminSalonFromRequest.mockResolvedValue({
    error: null,
    salon: { id: SALON_ID, name: 'Nail Salon No.5' },
    admin: { id: ADMIN_ID, name: 'Audit Owner' },
  });
});

afterAll(async () => {
  await client?.close();
});

async function approve(): Promise<Response> {
  return PATCH(
    new Request(`http://localhost/api/admin/time-off-requests/${REQUEST_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'APPROVED' }),
    }),
    { params: Promise.resolve({ id: REQUEST_ID }) },
  );
}

describe('time-off requests against a real DATE column', () => {
  it('lists the pending request instead of 500ing on the date mapper', async () => {
    const response = await GET(
      new Request('http://localhost/api/admin/time-off-requests?status=PENDING'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.requests).toHaveLength(1);
    expect(body.data.requests[0]).toMatchObject({
      id: REQUEST_ID,
      technicianName: 'Tiffany',
      startDate: START_DATE,
      endDate: END_DATE,
      status: 'PENDING',
    });
  });

  it('approving writes the technician_time_off block the availability engine reads', async () => {
    const response = await approve();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.request).toMatchObject({
      status: 'APPROVED',
      startDate: START_DATE,
      endDate: END_DATE,
    });

    const blocks = await db
      .select()
      .from(schema.technicianTimeOffSchema)
      .where(eq(schema.technicianTimeOffSchema.technicianId, TECH_ID));

    expect(blocks).toHaveLength(1);
    // Whole-day blocks go in at midnight UTC, matching the manual
    // ScheduleTab path (`new Date('YYYY-MM-DD').toISOString()`).
    expect(blocks[0]?.startDate.toISOString()).toBe(`${START_DATE}T00:00:00.000Z`);
    expect(blocks[0]?.endDate.toISOString()).toBe(`${END_DATE}T00:00:00.000Z`);
    expect(blocks[0]?.notes).toBe('Approved staff request: AUDIT-0905 family trip');

    const notifications = await db.select().from(schema.notificationSchema);

    expect(notifications).toHaveLength(1);
    // Formatted in UTC so the calendar day is not shifted by the server zone.
    expect(notifications[0]?.body).toContain('Sep 17 – Sep 18');
  });

  it('does not duplicate the block when an identical one already exists', async () => {
    await db.insert(schema.technicianTimeOffSchema).values({
      id: 'timeoff_audit_manual',
      technicianId: TECH_ID,
      salonId: SALON_ID,
      startDate: new Date(`${START_DATE}T00:00:00.000Z`),
      endDate: new Date(`${END_DATE}T00:00:00.000Z`),
      notes: 'AUDIT-0905 entered manually first',
    });

    const response = await approve();

    expect(response.status).toBe(200);

    const blocks = await db
      .select()
      .from(schema.technicianTimeOffSchema)
      .where(eq(schema.technicianTimeOffSchema.technicianId, TECH_ID));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe('timeoff_audit_manual');
  });

  it('refuses a second decision on an already-approved request', async () => {
    await approve();
    const response = await approve();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_STATE');
  });
});
