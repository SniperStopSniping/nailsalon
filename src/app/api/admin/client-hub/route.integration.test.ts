/** Client Insights integration (PGlite): canonical counts and filtered lists. */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { GET as GET_INSIGHTS } from '../client-insights/route';
import { GET as GET_CLIENTS } from '../clients/route';
import { GET as GET_ALIAS } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async (slug: string) => {
    if (slug === 'staff-only') {
      return {
        salon: null,
        error: Response.json(
          { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
          { status: 401 },
        ),
      };
    }
    if (slug !== 'insights-salon') {
      return {
        salon: null,
        error: Response.json(
          { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
          { status: 404 },
        ),
      };
    }
    return {
      salon: {
        id: 'salon_insights',
        slug,
        settings: {
          booking: {
            timezone: 'America/Toronto',
            currency: 'CAD',
          },
        },
      },
      error: null,
    };
  }),
}));

const SALON_ID = 'salon_insights';
const NOW = new Date('2026-07-15T16:00:00.000Z');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

type AppointmentSeed = typeof schema.appointmentSchema.$inferInsert;

function completed(
  id: string,
  salonClientId: string,
  startTime: string,
  overrides: Partial<AppointmentSeed> = {},
): AppointmentSeed {
  const start = new Date(startTime);
  return {
    id,
    salonId: SALON_ID,
    salonClientId,
    clientPhone: `41655502${salonClientId.slice(-2).padStart(2, '0')}`,
    clientName: `Client ${salonClientId}`,
    startTime: start,
    endTime: new Date(start.getTime() + 3_600_000),
    status: 'completed',
    completedAt: start,
    totalPrice: 8000,
    totalDurationMinutes: 60,
    paymentStatus: 'paid',
    ...overrides,
  };
}

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Insights Salon',
    slug: 'insights-salon',
    settings: {
      booking: {
        timezone: 'America/Toronto',
        currency: 'CAD',
      },
    },
  });

  await db.insert(schema.salonClientSchema).values([
    { id: 'client_a', salonId: SALON_ID, phone: '4165550201', fullName: 'Active New', rebookIntervalDays: 21 },
    { id: 'client_b', salonId: SALON_ID, phone: '4165550202', fullName: 'Due Soon', rebookIntervalDays: 21 },
    { id: 'client_c', salonId: SALON_ID, phone: '4165550203', fullName: 'Due Now', rebookIntervalDays: 21 },
    { id: 'client_d', salonId: SALON_ID, phone: '4165550204', fullName: 'Overdue Cancelled', rebookIntervalDays: 21 },
    { id: 'client_e', salonId: SALON_ID, phone: '4165550205', fullName: 'Blocked Overdue', rebookIntervalDays: 21, isBlocked: true },
    { id: 'client_f', salonId: SALON_ID, phone: '4165550206', fullName: 'Dismissed Overdue', rebookIntervalDays: 21 },
    { id: 'client_g', salonId: SALON_ID, phone: '4165550207', fullName: 'Outstanding Client', rebookIntervalDays: 100 },
    { id: 'client_h', salonId: SALON_ID, phone: '4165550208', fullName: 'Future Only', rebookIntervalDays: 21 },
    { id: 'client_i', salonId: SALON_ID, phone: '4165550209', fullName: 'Inactive Overdue', rebookIntervalDays: 21 },
  ]);

  await db.insert(schema.appointmentSchema).values([
    completed('appt_a', 'client_a', '2026-07-02T16:00:00.000Z', { clientPhone: '4165550201' }),
    completed('appt_b', 'client_b', '2026-06-27T16:00:00.000Z', { clientPhone: '4165550202' }),
    completed('appt_c', 'client_c', '2026-06-24T16:00:00.000Z', { clientPhone: '4165550203' }),
    completed('appt_d', 'client_d', '2026-06-01T16:00:00.000Z', { clientPhone: '4165550204' }),
    completed('appt_e', 'client_e', '2026-06-01T16:00:00.000Z', { clientPhone: '4165550205' }),
    completed('appt_f', 'client_f', '2026-06-01T16:00:00.000Z', { clientPhone: '4165550206' }),
    completed('appt_g', 'client_g', '2026-07-01T16:00:00.000Z', {
      clientPhone: '4165550207',
      finalPriceCents: 10000,
      totalPrice: 11000,
      taxAmountCents: 1300,
      tipCents: 500,
      amountPaidCents: 4000,
      paymentStatus: 'partially_paid',
    }),
    completed('appt_i', 'client_i', '2026-03-01T16:00:00.000Z', { clientPhone: '4165550209' }),
    {
      id: 'future_a',
      salonId: SALON_ID,
      salonClientId: 'client_a',
      clientPhone: '4165550201',
      clientName: 'Active New',
      startTime: new Date('2026-07-20T16:00:00.000Z'),
      endTime: new Date('2026-07-20T17:00:00.000Z'),
      status: 'confirmed',
      totalPrice: 9000,
      totalDurationMinutes: 60,
    },
    {
      id: 'future_h',
      salonId: SALON_ID,
      salonClientId: 'client_h',
      clientPhone: '4165550208',
      clientName: 'Future Only',
      startTime: new Date('2026-07-25T16:00:00.000Z'),
      endTime: new Date('2026-07-25T17:00:00.000Z'),
      status: 'pending',
      totalPrice: 9000,
      totalDurationMinutes: 60,
    },
    {
      id: 'cancel_d',
      salonId: SALON_ID,
      salonClientId: 'client_d',
      clientPhone: '4165550204',
      clientName: 'Overdue Cancelled',
      startTime: new Date('2026-07-18T16:00:00.000Z'),
      endTime: new Date('2026-07-18T17:00:00.000Z'),
      status: 'cancelled',
      updatedAt: new Date('2026-07-10T16:00:00.000Z'),
      totalPrice: 9000,
      totalDurationMinutes: 60,
    },
  ]);

  await db.insert(schema.appointmentPaymentSchema).values({
    id: 'payment_g',
    appointmentId: 'appt_g',
    salonId: SALON_ID,
    amountCents: 4000,
    method: 'cash',
    recordedByType: 'admin',
    recordedAt: new Date('2026-07-01T17:00:00.000Z'),
  });

  await db.insert(schema.clientCommunicationSchema).values({
    id: 'dismiss_f',
    salonId: SALON_ID,
    salonClientId: 'client_f',
    kind: 'promo_6w',
    status: 'dismissed',
    createdAt: new Date('2026-07-10T16:00:00.000Z'),
    dismissedAt: new Date('2026-07-10T16:00:00.000Z'),
  });
}, 60_000);

afterAll(async () => {
  vi.useRealTimers();
  await client.close();
});

async function insights(route = GET_INSIGHTS) {
  const response = await route(
    new Request('http://localhost/api/admin/client-insights?salonSlug=insights-salon'),
  );
  return { response, body: await response.json() };
}

describe('GET /api/admin/client-insights', () => {
  it('returns salon-local client health without legacy Hub financial reports', async () => {
    const { response, body } = await insights();
    const count = (id: string) =>
      body.data.segments.find((segment: { id: string }) => segment.id === id)?.count;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(body.data.timeZone).toBe('America/Toronto');
    expect(body.data.kpis.new_this_month).toBe(2);
    expect(body.data.kpis.due_to_return).toBe(2);
    expect(body.data.kpis.overdue).toBe(2);
    expect(count('due_soon')).toBe(1);
    expect(count('due_now')).toBe(1);
    expect(count('recent_cancellation')).toBe(1);
    expect(count('inactive_90')).toBe(1);
    expect(count('completed_outstanding')).toBe(1);
    expect(body.data.reports).toBeUndefined();
  });

  it('keeps the old Client Hub route as an exact compatibility alias', async () => {
    const canonical = await insights(GET_INSIGHTS);
    const alias = await insights(GET_ALIAS);

    expect(alias.response.status).toBe(200);
    expect(alias.body).toEqual(canonical.body);
  });

  it('uses the same definition for counts and paginated directory results', async () => {
    const { body } = await insights();
    const overdueCount = body.data.kpis.overdue;

    const response = await GET_CLIENTS(new Request(
      'http://localhost/api/admin/clients?salonSlug=insights-salon&segment=overdue&page=1&limit=1',
    ));
    const list = await response.json();

    expect(response.status).toBe(200);
    expect(list.data.pagination.total).toBe(overdueCount);
    expect(list.data.pagination.totalPages).toBe(2);
    expect(list.data.filter.segment).toBe('overdue');
    expect(list.data.clients).toHaveLength(1);
    expect(['client_d', 'client_i']).toContain(list.data.clients[0].id);
  });

  it('composes search with a server-side segment and validates segment IDs', async () => {
    const searched = await GET_CLIENTS(new Request(
      'http://localhost/api/admin/clients?salonSlug=insights-salon&segment=overdue&search=Inactive',
    ));
    const searchedBody = await searched.json();

    expect(searched.status).toBe(200);
    expect(searchedBody.data.pagination.total).toBe(1);
    expect(searchedBody.data.clients[0].id).toBe('client_i');

    const invalid = await GET_CLIENTS(new Request(
      'http://localhost/api/admin/clients?salonSlug=insights-salon&segment=not-real',
    ));

    expect(invalid.status).toBe(400);
  });

  it('uses the established non-disclosing tenant denial', async () => {
    const response = await GET_INSIGHTS(new Request(
      'http://localhost/api/admin/client-insights?salonSlug=other-salon',
    ));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(body)).not.toContain('insights-salon');
    expect(JSON.stringify(body)).not.toContain('client_');
  });

  it('keeps Client Insights and filtered directory data unavailable to staff-only sessions', async () => {
    const insightsResponse = await GET_INSIGHTS(new Request(
      'http://localhost/api/admin/client-insights?salonSlug=staff-only',
    ));
    const clientsResponse = await GET_CLIENTS(new Request(
      'http://localhost/api/admin/clients?salonSlug=staff-only&segment=active',
    ));

    expect(insightsResponse.status).toBe(401);
    expect(clientsResponse.status).toBe(401);
    expect(insightsResponse.headers.get('cache-control')).toContain('no-store');
    expect(clientsResponse.headers.get('cache-control')).toContain('no-store');
  });
});
