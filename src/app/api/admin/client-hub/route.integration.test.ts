/** Client Insights integration (PGlite): canonical counts and filtered lists. */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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

const legacyTopServiceSchema = z.object({
  name: z.string().nullable(),
  count: z.number(),
});

/** Frozen runtime contract from main at f45e745. */
const legacyClientHubContract = z.object({
  data: z.object({
    overview: z.object({
      totalClients: z.number(),
      newClientsThisMonth: z.number(),
      returningClients: z.number(),
      dueToReturn: z.number(),
      overdue: z.number(),
      noFutureAppointment: z.number(),
      completedAppointments: z.number(),
      cancellationRate: z.number().nullable(),
      noShowRate: z.number().nullable(),
      rebookingRate: z.number().nullable(),
      topServices: z.array(legacyTopServiceSchema),
      serviceRevenueCents: z.number(),
      outstandingCents: z.number(),
    }),
    segments: z.array(z.object({
      id: z.string(),
      label: z.string(),
      count: z.number(),
    })),
    reports: z.object({
      finishedAppointments: z.number(),
      completed: z.number(),
      cancelled: z.number(),
      noShows: z.number(),
      cancellationRate: z.number().nullable(),
      noShowRate: z.number().nullable(),
      rebookingRate: z.number().nullable(),
      serviceRevenueCents: z.number(),
      discountCents: z.number(),
      taxCollectedCents: z.number(),
      tipsCents: z.number(),
      amountPaidCents: z.number(),
      outstandingCents: z.number(),
      promotionsMinted: z.number(),
      promotionsRedeemed: z.number(),
      topServices: z.array(legacyTopServiceSchema),
    }),
  }),
});

const clientInsightsContract = z.object({
  data: z.object({
    generatedAt: z.string(),
    timeZone: z.string(),
    rulesVersion: z.string(),
    kpis: z.object({
      active: z.number(),
      new_this_month: z.number(),
      due_to_return: z.number(),
      overdue: z.number(),
    }),
    segments: z.array(z.object({
      id: z.string(),
      label: z.string(),
      count: z.number(),
    })),
    attention: z.object({
      total: z.number(),
      items: z.array(z.object({
        clientId: z.string(),
        clientName: z.string().nullable(),
        phone: z.string(),
        email: z.string().nullable(),
        primaryReason: z.string(),
        reasons: z.array(z.string()),
        lastVisitAt: z.string().nullable(),
        expectedReturnAt: z.string().nullable(),
        completedOutstandingCents: z.number(),
        outreachStage: z.string().nullable(),
      })),
    }),
  }),
});

const LEGACY_SEGMENT_IDS = [
  'new_this_month',
  'returning',
  'due_to_return',
  'overdue',
  'no_future_appointment',
  'not_seen_60d',
  'not_seen_90d',
  'recently_cancelled',
  'previous_no_shows',
  'builder_gel',
  'manicure',
  'pedicure',
  'extensions',
  'sms_consent',
];

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

async function legacyHub(salonSlug = 'insights-salon') {
  const response = await GET_ALIAS(
    new Request(
      `http://localhost/api/admin/client-hub?salonSlug=${encodeURIComponent(salonSlug)}`,
    ),
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

  it('keeps Client Hub as a deprecated f45e745 contract adapter', async () => {
    const canonical = await insights(GET_INSIGHTS);
    const legacy = await legacyHub();
    const parsed = legacyClientHubContract.parse(legacy.body);
    const parsedCanonical = clientInsightsContract.parse(canonical.body);

    expect(legacy.response.status).toBe(200);
    expect(legacy.response.headers.get('cache-control')).toContain('private');
    expect(legacy.response.headers.get('cache-control')).toContain('no-store');
    expect(parsed.data.segments.map(segment => segment.id)).toEqual(
      LEGACY_SEGMENT_IDS,
    );
    expect(parsed.data.overview.serviceRevenueCents).toBe(66000);
    expect(parsed.data.overview.outstandingCents).toBe(7800);
    expect(parsed.data.reports).toMatchObject({
      completed: 8,
      cancelled: 1,
      noShows: 0,
      serviceRevenueCents: 66000,
      taxCollectedCents: 1300,
      tipsCents: 500,
      amountPaidCents: 4000,
      outstandingCents: 7800,
    });

    expect(parsedCanonical.data.kpis).toBeDefined();
    expect(parsedCanonical.data.attention).toBeDefined();
    expect(canonical.body.data).not.toHaveProperty('overview');
    expect(canonical.body.data).not.toHaveProperty('reports');
  });

  it('keeps legacy validation and authorization responses private', async () => {
    const invalidResponse = await GET_ALIAS(
      new Request('http://localhost/api/admin/client-hub'),
    );
    const invalidBody = await invalidResponse.json();
    const denied = await legacyHub('other-salon');

    expect(invalidResponse.status).toBe(400);
    expect(invalidBody).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid client hub query.',
      },
    });
    expect(invalidResponse.headers.get('cache-control')).toContain('no-store');
    expect(denied.response.status).toBe(404);
    expect(denied.response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(denied.body)).not.toContain('client_');
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

  it('counts only active terminal profiles while preserving raw appointment reports', async () => {
    const before = legacyClientHubContract.parse((await legacyHub()).body);
    const beforeSegments = new Map(
      before.data.segments.map(segment => [segment.id, segment.count]),
    );

    await db.insert(schema.salonSchema).values({
      id: 'salon_lifecycle_foreign',
      name: 'Lifecycle Foreign Salon',
      slug: 'lifecycle-foreign-salon',
    });
    await db.insert(schema.salonClientSchema).values([
      {
        id: 'hub_lifecycle_primary',
        salonId: SALON_ID,
        phone: '4165550901',
        fullName: 'Lifecycle Primary',
        lastVisitAt: new Date('2026-06-20T16:00:00.000Z'),
        totalVisits: 2,
        createdAt: new Date('2026-07-01T16:00:00.000Z'),
      },
      {
        id: 'hub_lifecycle_middle',
        salonId: SALON_ID,
        phone: '4165550902',
        fullName: 'Lifecycle Middle',
        totalVisits: 50,
        noShowCount: 50,
        createdAt: new Date('2026-07-01T16:00:00.000Z'),
      },
      {
        id: 'hub_lifecycle_source',
        salonId: SALON_ID,
        phone: '4165550903',
        fullName: 'Lifecycle Source',
        totalVisits: 50,
        noShowCount: 50,
        createdAt: new Date('2026-07-01T16:00:00.000Z'),
      },
      {
        id: 'hub_lifecycle_archived',
        salonId: SALON_ID,
        phone: '4165550904',
        fullName: 'Lifecycle Archived',
        archivedAt: new Date('2026-07-10T16:00:00.000Z'),
        totalVisits: 50,
        noShowCount: 50,
        createdAt: new Date('2026-07-01T16:00:00.000Z'),
      },
      {
        id: 'hub_lifecycle_no_future',
        salonId: SALON_ID,
        phone: '4165550905',
        fullName: 'Lifecycle No Future',
        createdAt: new Date('2026-07-01T16:00:00.000Z'),
      },
      {
        id: 'hub_lifecycle_alias_future',
        salonId: SALON_ID,
        phone: '4165550906',
        fullName: 'Lifecycle Alias Future',
        createdAt: new Date('2026-07-01T16:00:00.000Z'),
      },
      {
        id: 'hub_lifecycle_ambiguous_a',
        salonId: SALON_ID,
        phone: '4165550997',
        fullName: 'Lifecycle Ambiguous A',
        createdAt: new Date('2026-07-01T16:00:00.000Z'),
      },
      {
        id: 'hub_lifecycle_ambiguous_b',
        salonId: SALON_ID,
        phone: '4165550996',
        fullName: 'Lifecycle Ambiguous B',
        createdAt: new Date('2026-07-01T16:00:00.000Z'),
      },
      {
        id: 'hub_lifecycle_foreign',
        salonId: 'salon_lifecycle_foreign',
        phone: '4165550999',
        fullName: 'Lifecycle Foreign',
        createdAt: new Date('2026-07-01T16:00:00.000Z'),
      },
    ]);
    await db.insert(schema.salonClientContactAliasSchema).values([
      {
        salonId: SALON_ID,
        salonClientId: 'hub_lifecycle_alias_future',
        kind: 'phone',
        normalizedValue: '4165550998',
      },
      {
        salonId: SALON_ID,
        salonClientId: 'hub_lifecycle_ambiguous_b',
        kind: 'phone',
        normalizedValue: '4165550997',
      },
    ]);

    await db.insert(schema.serviceSchema).values({
      id: 'hub_lifecycle_service',
      salonId: SALON_ID,
      name: 'Lifecycle Manicure',
      price: 10000,
      durationMinutes: 60,
      category: 'manicure',
    });

    await db.insert(schema.appointmentSchema).values([
      completed(
        'hub_lifecycle_completed_source',
        'hub_lifecycle_source',
        '2026-06-10T16:00:00.000Z',
        {
          clientPhone: '4165550903',
          totalPrice: 10000,
          amountPaidCents: 10000,
        },
      ),
      completed(
        'hub_lifecycle_completed_middle',
        'hub_lifecycle_middle',
        '2026-06-11T16:00:00.000Z',
        {
          clientPhone: '4165550902',
          totalPrice: 12000,
          amountPaidCents: 12000,
        },
      ),
      {
        id: 'hub_lifecycle_future_source',
        salonId: SALON_ID,
        salonClientId: 'hub_lifecycle_source',
        clientPhone: '4165550903',
        clientName: 'Lifecycle Source',
        startTime: new Date('2026-07-25T16:00:00.000Z'),
        endTime: new Date('2026-07-25T17:00:00.000Z'),
        status: 'confirmed',
        totalPrice: 9000,
        totalDurationMinutes: 60,
      },
      {
        id: 'hub_lifecycle_cancelled_middle',
        salonId: SALON_ID,
        salonClientId: 'hub_lifecycle_middle',
        clientPhone: '4165550902',
        clientName: 'Lifecycle Middle',
        startTime: new Date('2026-07-18T16:00:00.000Z'),
        endTime: new Date('2026-07-18T17:00:00.000Z'),
        status: 'cancelled',
        updatedAt: new Date('2026-07-10T16:00:00.000Z'),
        totalPrice: 9000,
        totalDurationMinutes: 60,
      },
      {
        id: 'hub_lifecycle_future_alias',
        salonId: SALON_ID,
        salonClientId: null,
        clientPhone: '+1 (416) 555-0998',
        clientName: 'Lifecycle Alias Future',
        startTime: new Date('2026-07-27T16:00:00.000Z'),
        endTime: new Date('2026-07-27T17:00:00.000Z'),
        status: 'confirmed',
        totalPrice: 9000,
        totalDurationMinutes: 60,
      },
      {
        ...completed(
          'hub_lifecycle_completed_alias',
          'hub_lifecycle_alias_future',
          '2026-06-12T16:00:00.000Z',
          {
            salonClientId: null,
            clientPhone: '+1 (416) 555-0998',
            totalPrice: 5000,
            amountPaidCents: 5000,
          },
        ),
      },
      {
        id: 'hub_lifecycle_cancelled_alias',
        salonId: SALON_ID,
        salonClientId: null,
        clientPhone: '+1 (416) 555-0998',
        clientName: 'Lifecycle Alias Future',
        startTime: new Date('2026-07-19T16:00:00.000Z'),
        endTime: new Date('2026-07-19T17:00:00.000Z'),
        status: 'cancelled',
        updatedAt: new Date('2026-07-11T16:00:00.000Z'),
        totalPrice: 9000,
        totalDurationMinutes: 60,
      },
      {
        id: 'hub_lifecycle_future_ambiguous',
        salonId: SALON_ID,
        salonClientId: null,
        clientPhone: '4165550997',
        clientName: 'Lifecycle Ambiguous',
        startTime: new Date('2026-07-28T16:00:00.000Z'),
        endTime: new Date('2026-07-28T17:00:00.000Z'),
        status: 'confirmed',
        totalPrice: 9000,
        totalDurationMinutes: 60,
      },
    ]);
    await db.insert(schema.appointmentServicesSchema).values([
      {
        id: 'hub_lifecycle_service_source',
        appointmentId: 'hub_lifecycle_completed_source',
        serviceId: 'hub_lifecycle_service',
        priceAtBooking: 10000,
        durationAtBooking: 60,
        nameSnapshot: 'Lifecycle Manicure',
        categorySnapshot: 'manicure',
      },
      {
        id: 'hub_lifecycle_service_middle',
        appointmentId: 'hub_lifecycle_completed_middle',
        serviceId: 'hub_lifecycle_service',
        priceAtBooking: 12000,
        durationAtBooking: 60,
        nameSnapshot: 'Lifecycle Manicure',
        categorySnapshot: 'manicure',
      },
      {
        id: 'hub_lifecycle_service_alias',
        appointmentId: 'hub_lifecycle_completed_alias',
        serviceId: 'hub_lifecycle_service',
        priceAtBooking: 5000,
        durationAtBooking: 60,
        nameSnapshot: 'Lifecycle Pedicure',
        categorySnapshot: 'pedicure',
      },
    ]);

    await db.execute(sql.raw(
      'ALTER TABLE salon_client DISABLE TRIGGER salon_client_enforce_merge_transition',
    ));
    try {
      await db.execute(sql.raw(`
        UPDATE salon_client
        SET archived_at = '2026-07-10T16:00:00.000Z',
            archived_by = 'lifecycle-test',
            merged_into_client_id = 'hub_lifecycle_primary',
            merged_at = '2026-07-10T16:00:00.000Z',
            merged_by = 'lifecycle-test'
        WHERE id = 'hub_lifecycle_middle'
      `));
      await db.execute(sql.raw(`
        UPDATE salon_client
        SET archived_at = '2026-07-10T16:00:00.000Z',
            archived_by = 'lifecycle-test',
            merged_into_client_id = 'hub_lifecycle_middle',
            merged_at = '2026-07-10T16:00:00.000Z',
            merged_by = 'lifecycle-test'
        WHERE id = 'hub_lifecycle_source'
      `));
    } finally {
      await db.execute(sql.raw(
        'ALTER TABLE salon_client ENABLE TRIGGER salon_client_enforce_merge_transition',
      ));
    }

    // This deliberately inconsistent stable reference proves that a non-null
    // foreign-salon ID is dropped rather than converted into a legacy
    // phone-fallback appointment for hub_lifecycle_no_future.
    await db.execute(sql.raw(
      'ALTER TABLE appointment DISABLE TRIGGER appointment_resolve_merged_client',
    ));
    try {
      await db.insert(schema.appointmentSchema).values({
        id: 'hub_lifecycle_invalid_future',
        salonId: SALON_ID,
        salonClientId: 'hub_lifecycle_foreign',
        clientPhone: '4165550905',
        clientName: 'Lifecycle No Future',
        startTime: new Date('2026-07-26T16:00:00.000Z'),
        endTime: new Date('2026-07-26T17:00:00.000Z'),
        status: 'confirmed',
        totalPrice: 9000,
        totalDurationMinutes: 60,
      });
    } finally {
      await db.execute(sql.raw(
        'ALTER TABLE appointment ENABLE TRIGGER appointment_resolve_merged_client',
      ));
    }

    const afterResult = await legacyHub();
    const after = legacyClientHubContract.parse(afterResult.body);
    const afterSegments = new Map(
      after.data.segments.map(segment => [segment.id, segment.count]),
    );

    expect(afterResult.response.status).toBe(200);
    expect(after.data.overview.totalClients).toBe(
      before.data.overview.totalClients + 5,
    );
    expect(after.data.overview.newClientsThisMonth).toBe(
      before.data.overview.newClientsThisMonth + 5,
    );
    expect(after.data.overview.returningClients).toBe(
      before.data.overview.returningClients + 1,
    );
    expect(afterSegments.get('previous_no_shows')).toBe(
      beforeSegments.get('previous_no_shows'),
    );
    expect(afterSegments.get('no_future_appointment')).toBe(
      (beforeSegments.get('no_future_appointment') ?? 0) + 3,
    );
    expect(afterSegments.get('recently_cancelled')).toBe(
      (beforeSegments.get('recently_cancelled') ?? 0) + 2,
    );
    expect(afterSegments.get('manicure')).toBe(
      (beforeSegments.get('manicure') ?? 0) + 1,
    );
    expect(afterSegments.get('pedicure')).toBe(
      (beforeSegments.get('pedicure') ?? 0) + 1,
    );

    // Report totals remain appointment-based: both historical source
    // appointments and the cancellation remain present exactly once.
    expect(after.data.reports.completed).toBe(
      before.data.reports.completed + 3,
    );
    expect(after.data.reports.cancelled).toBe(
      before.data.reports.cancelled + 2,
    );
    expect(after.data.reports.finishedAppointments).toBe(
      before.data.reports.finishedAppointments + 5,
    );
    expect(after.data.reports.serviceRevenueCents).toBe(
      before.data.reports.serviceRevenueCents + 27000,
    );
    expect(after.data.reports.outstandingCents).toBe(
      before.data.reports.outstandingCents,
    );
  });
});
