import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';
import type { ClientInsightSegmentId } from '@/types/clientInsights';

import {
  getClientInsightsDirectoryPage,
  getClientInsightsSnapshot,
} from './clientInsights.server';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const SALON_ID = 'salon_projection';
const OTHER_SALON_ID = 'salon_other';
const TIME_ZONE = 'America/Toronto';
const NOW = new Date('2026-07-15T16:00:00.000Z');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let phoneCounter = 0;

type ClientSeed = typeof schema.salonClientSchema.$inferInsert;
type AppointmentSeed = typeof schema.appointmentSchema.$inferInsert;

function nextPhone(): string {
  phoneCounter += 1;
  return `416${String(phoneCounter).padStart(7, '0')}`;
}

async function addClient(
  id: string,
  overrides: Partial<ClientSeed> = {},
): Promise<ClientSeed> {
  const row: ClientSeed = {
    id,
    salonId: SALON_ID,
    phone: nextPhone(),
    fullName: `Client ${id}`,
    rebookIntervalDays: 21,
    ...overrides,
  };
  await db.insert(schema.salonClientSchema).values(row);
  return row;
}

async function addAppointment(args: {
  id: string;
  clientId?: string | null;
  phone: string;
  start: string;
  status?: string;
  salonId?: string;
  overrides?: Partial<AppointmentSeed>;
}): Promise<AppointmentSeed> {
  const start = new Date(args.start);
  const row: AppointmentSeed = {
    id: args.id,
    salonId: args.salonId ?? SALON_ID,
    salonClientId: args.clientId ?? null,
    clientPhone: args.phone,
    clientName: `Appointment ${args.id}`,
    startTime: start,
    endTime: new Date(start.getTime() + 3_600_000),
    status: args.status ?? 'completed',
    completedAt: args.status && args.status !== 'completed' ? null : start,
    totalPrice: 8000,
    totalDurationMinutes: 60,
    paymentStatus: 'paid',
    ...args.overrides,
  };
  await db.insert(schema.appointmentSchema).values(row);
  return row;
}

async function addPreMigrationAppointment(args: Parameters<typeof addAppointment>[0]) {
  await client.exec(
    'ALTER TABLE appointment DISABLE TRIGGER appointment_resolve_merged_client',
  );
  try {
    return await addAppointment(args);
  } finally {
    await client.exec(
      'ALTER TABLE appointment ENABLE TRIGGER appointment_resolve_merged_client',
    );
  }
}

async function snapshot(now: Date = NOW) {
  return getClientInsightsSnapshot({
    salonId: SALON_ID,
    timeZone: TIME_ZONE,
    now,
  });
}

function segmentCount(
  result: Awaited<ReturnType<typeof snapshot>>,
  segment: ClientInsightSegmentId,
): number {
  return result.data.segments.find(item => item.id === segment)?.count ?? -1;
}

async function segmentIds(
  segment: ClientInsightSegmentId,
  options: {
    now?: Date;
    page?: number;
    limit?: number;
    search?: string;
  } = {},
): Promise<{ ids: string[]; total: number }> {
  const result = await getClientInsightsDirectoryPage({
    salonId: SALON_ID,
    timeZone: TIME_ZONE,
    now: options.now ?? NOW,
    segment,
    search: options.search,
    sortBy: 'name',
    sortOrder: 'asc',
    page: options.page ?? 1,
    limit: options.limit ?? 100,
  });
  return {
    ids: result.clients.map(item => item.id),
    total: result.total,
  };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

beforeEach(async () => {
  phoneCounter = 0;
  await db.delete(schema.salonSchema);
  await db.insert(schema.salonSchema).values([
    {
      id: SALON_ID,
      name: 'Projection Salon',
      slug: 'projection-salon',
    },
    {
      id: OTHER_SALON_ID,
      name: 'Other Salon',
      slug: 'other-salon',
    },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('canonical Client Insights SQL projection', () => {
  it('keeps due bands disjoint at +7, +1, 0, -7 and -8 days', async () => {
    const cases = [
      ['plus-7', '2026-07-01T16:00:00.000Z'],
      ['plus-1', '2026-06-25T16:00:00.000Z'],
      ['zero', '2026-06-24T16:00:00.000Z'],
      ['minus-7', '2026-06-17T16:00:00.000Z'],
      ['minus-8', '2026-06-16T16:00:00.000Z'],
    ] as const;

    for (const [id, date] of cases) {
      const person = await addClient(id);
      await addAppointment({
        id: `appointment-${id}`,
        clientId: id,
        phone: person.phone,
        start: date,
      });
    }

    const result = await snapshot();

    expect((await segmentIds('due_soon')).ids).toEqual(['plus-1', 'plus-7']);
    expect((await segmentIds('due_now')).ids).toEqual(['minus-7', 'zero']);
    expect((await segmentIds('overdue')).ids).toEqual(['minus-8']);
    expect(segmentCount(result, 'due_to_return')).toBe(4);
    expect(segmentCount(result, 'needs_rebooking')).toBe(5);
  });

  it('uses exact 28, 30, 60 and 90 salon-calendar-day thresholds', async () => {
    const cases = [
      ['day-28', '2026-06-17T16:00:00.000Z'],
      ['day-30', '2026-06-15T16:00:00.000Z'],
      ['day-60', '2026-05-16T16:00:00.000Z'],
      ['day-90', '2026-04-16T16:00:00.000Z'],
    ] as const;

    for (const [id, date] of cases) {
      const person = await addClient(id, { rebookIntervalDays: 365 });
      await addAppointment({
        id: `appointment-${id}`,
        clientId: id,
        phone: person.phone,
        start: date,
      });
    }

    expect((await segmentIds('first_time_no_return')).ids).toEqual([
      'day-28',
      'day-30',
      'day-60',
      'day-90',
    ]);
    expect((await segmentIds('not_seen_30')).ids).toEqual([
      'day-30',
      'day-60',
      'day-90',
    ]);
    expect((await segmentIds('not_seen_60')).ids).toEqual([
      'day-60',
      'day-90',
    ]);
    expect((await segmentIds('inactive_90')).ids).toEqual(['day-90']);
    expect((await segmentIds('active')).ids).toEqual([
      'day-28',
      'day-30',
      'day-60',
    ]);
  });

  it('keeps health counts independent while enforcing proactive and 14-day cancellation gates', async () => {
    const blocked = await addClient('blocked', { isBlocked: true });
    await addAppointment({
      id: 'blocked-visit',
      clientId: blocked.id,
      phone: blocked.phone,
      start: '2026-07-02T16:00:00.000Z',
      overrides: {
        finalPriceCents: 1000,
        amountPaidCents: 0,
        paymentStatus: 'partially_paid',
      },
    });

    const future = await addClient('future');
    await addAppointment({
      id: 'future-old-visit',
      clientId: future.id,
      phone: future.phone,
      start: '2026-05-01T16:00:00.000Z',
    });
    await addAppointment({
      id: 'future-booking',
      clientId: future.id,
      phone: future.phone,
      start: '2026-07-20T16:00:00.000Z',
      status: 'confirmed',
    });

    for (const [id, cancelledAt] of [
      ['cancel-day-14', '2026-07-01T16:00:00.000Z'],
      ['cancel-day-15', '2026-06-30T16:00:00.000Z'],
    ] as const) {
      const person = await addClient(id);
      await addAppointment({
        id: `old-visit-${id}`,
        clientId: id,
        phone: person.phone,
        start: '2026-05-01T16:00:00.000Z',
      });
      await addAppointment({
        id: `cancellation-${id}`,
        clientId: id,
        phone: person.phone,
        start: '2026-07-20T16:00:00.000Z',
        status: 'cancelled',
        overrides: { updatedAt: new Date(cancelledAt) },
      });
    }

    expect((await segmentIds('active')).ids).toEqual([
      'blocked',
      'cancel-day-14',
      'cancel-day-15',
      'future',
    ]);
    expect((await segmentIds('new_this_month')).ids).toEqual(['blocked']);
    expect((await segmentIds('rebooked')).ids).toEqual(['future']);

    const noFuture = await segmentIds('no_future_appointment');

    expect(noFuture.ids).not.toContain('blocked');
    expect(noFuture.ids).not.toContain('future');
    expect((await segmentIds('completed_outstanding')).ids).not.toContain(
      'blocked',
    );
    expect((await segmentIds('recent_cancellation')).ids).toEqual([
      'cancel-day-14',
    ]);
  });

  it('uses Toronto-local midnight and calendar dates across both DST changes', async () => {
    const spring = await addClient('spring', { rebookIntervalDays: 1 });
    await addAppointment({
      id: 'spring-visit',
      clientId: 'spring',
      phone: spring.phone,
      start: '2026-03-07T17:00:00.000Z',
    });

    const beforeSpringMidnight = new Date('2026-03-08T04:59:00.000Z');
    const afterSpringMidnight = new Date('2026-03-08T05:01:00.000Z');

    expect((await segmentIds('due_soon', {
      now: beforeSpringMidnight,
    })).ids).toEqual(['spring']);
    expect((await segmentIds('due_now', {
      now: afterSpringMidnight,
    })).ids).toEqual(['spring']);

    const fall = await addClient('fall', { rebookIntervalDays: 1 });
    await addAppointment({
      id: 'fall-visit',
      clientId: 'fall',
      phone: fall.phone,
      start: '2026-10-31T16:00:00.000Z',
    });
    const beforeFallMidnight = new Date('2026-11-01T03:59:00.000Z');
    const afterFallMidnight = new Date('2026-11-01T04:01:00.000Z');

    expect((await segmentIds('due_soon', {
      now: beforeFallMidnight,
    })).ids).toEqual(['fall']);
    expect((await segmentIds('due_now', {
      now: afterFallMidnight,
    })).ids).toEqual(['fall']);

    const localJune = await addClient('local-june');
    const localJuly = await addClient('local-july');
    await addAppointment({
      id: 'local-june-visit',
      clientId: 'local-june',
      phone: localJune.phone,
      start: '2026-07-01T03:30:00.000Z',
    });
    await addAppointment({
      id: 'local-july-visit',
      clientId: 'local-july',
      phone: localJuly.phone,
      start: '2026-07-01T04:30:00.000Z',
    });

    expect((await segmentIds('new_this_month')).ids).toContain('local-july');
    expect((await segmentIds('new_this_month')).ids).not.toContain('local-june');
  });

  it('reuses communication eligibility and resets each stage after a new visit', async () => {
    const eligibleStatuses = ['prepared', 'not_sent'] as const;
    const suppressedStatuses = [
      'marked_sent',
      'snoozed',
      'dismissed',
      'converted',
    ] as const;

    for (const status of eligibleStatuses) {
      const id = `eligible-${status}`;
      const person = await addClient(id);
      await addAppointment({
        id: `visit-${id}`,
        clientId: id,
        phone: person.phone,
        start: '2026-06-24T16:00:00.000Z',
      });
      await db.insert(schema.clientCommunicationSchema).values({
        id: `communication-${id}`,
        salonId: SALON_ID,
        salonClientId: id,
        kind: 'rebook',
        status,
        createdAt: new Date('2026-07-10T16:00:00.000Z'),
      });
    }

    for (const status of suppressedStatuses) {
      const id = `suppressed-${status}`;
      const person = await addClient(id);
      await addAppointment({
        id: `visit-${id}`,
        clientId: id,
        phone: person.phone,
        start: '2026-06-24T16:00:00.000Z',
      });
      await db.insert(schema.clientCommunicationSchema).values({
        id: `communication-${id}`,
        salonId: SALON_ID,
        salonClientId: id,
        kind: 'rebook',
        status,
        snoozedUntil: status === 'snoozed'
          ? new Date('2026-07-20T16:00:00.000Z')
          : null,
        createdAt: new Date('2026-07-10T16:00:00.000Z'),
      });
    }

    const suppressedOutstanding = await addClient('suppressed-outstanding');
    await addAppointment({
      id: 'visit-suppressed-outstanding',
      clientId: suppressedOutstanding.id,
      phone: suppressedOutstanding.phone,
      start: '2026-06-24T16:00:00.000Z',
      overrides: {
        finalPriceCents: 10_000,
        amountPaidCents: 2_000,
        paymentStatus: 'partially_paid',
      },
    });
    await db.insert(schema.appointmentPaymentSchema).values({
      id: 'payment-suppressed-outstanding',
      appointmentId: 'visit-suppressed-outstanding',
      salonId: SALON_ID,
      amountCents: 2_000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-06-24T17:00:00.000Z'),
    });
    await db.insert(schema.clientCommunicationSchema).values({
      id: 'communication-suppressed-outstanding',
      salonId: SALON_ID,
      salonClientId: suppressedOutstanding.id,
      kind: 'rebook',
      status: 'dismissed',
      createdAt: new Date('2026-07-10T16:00:00.000Z'),
    });

    const cycles = [
      ['cycle-rebook', 'rebook', '2026-06-24T16:00:00.000Z'],
      ['cycle-6w', 'promo_6w', '2026-06-01T16:00:00.000Z'],
      ['cycle-8w', 'promo_8w', '2026-05-01T16:00:00.000Z'],
    ] as const;
    for (const [id, kind, visitAt] of cycles) {
      const person = await addClient(id);
      await addAppointment({
        id: `visit-${id}`,
        clientId: id,
        phone: person.phone,
        start: visitAt,
      });
      await db.insert(schema.clientCommunicationSchema).values({
        id: `old-${id}`,
        salonId: SALON_ID,
        salonClientId: id,
        kind,
        status: 'dismissed',
        createdAt: new Date(
          new Date(visitAt).getTime() - 86_400_000,
        ),
      });
    }

    const needsRebooking = await segmentIds('needs_rebooking');

    expect(needsRebooking.ids).toEqual(expect.arrayContaining([
      'eligible-not_sent',
      'eligible-prepared',
      'cycle-rebook',
      'cycle-6w',
      'cycle-8w',
    ]));

    for (const status of suppressedStatuses) {
      expect(needsRebooking.ids).not.toContain(`suppressed-${status}`);
    }

    const attentionIds = (await snapshot()).data.attention.items.map(
      item => item.clientId,
    );

    expect(attentionIds).toEqual(expect.arrayContaining([
      'eligible-not_sent',
      'eligible-prepared',
      'cycle-rebook',
      'cycle-6w',
      'cycle-8w',
      'suppressed-outstanding',
    ]));

    for (const status of suppressedStatuses) {
      expect(attentionIds).not.toContain(`suppressed-${status}`);
    }

    const outstandingAttention = (await snapshot()).data.attention.items.find(
      item => item.clientId === 'suppressed-outstanding',
    );

    expect(outstandingAttention).toMatchObject({
      primaryReason: 'completed_outstanding',
      reasons: ['completed_outstanding'],
    });
  });

  it('matches legacy phones only when null-ID ownership is unique and tenant-local', async () => {
    const unique = await addClient('unique', { phone: '4165550101' });
    await addClient('duplicate-a', { phone: '416-555-0202' });
    await addClient('duplicate-b', { phone: '(416) 555-0202' });
    const changed = await addClient('changed', { phone: '4165550303' });
    await addClient('cross-local', { phone: '4165550404' });
    await addClient('other-owner', {
      salonId: OTHER_SALON_ID,
      phone: '4165550404',
    });
    const foreign = await addClient('foreign-id', {
      salonId: OTHER_SALON_ID,
      phone: '4165550505',
    });

    await addAppointment({
      id: 'legacy-unique',
      phone: '+1 (416) 555-0101',
      start: '2026-07-10T16:00:00.000Z',
    });
    await addAppointment({
      id: 'legacy-duplicate',
      phone: '4165550202',
      start: '2026-07-10T16:00:00.000Z',
    });
    await addAppointment({
      id: 'legacy-blank',
      phone: '',
      start: '2026-07-10T16:00:00.000Z',
    });
    await addAppointment({
      id: 'legacy-malformed',
      phone: 'not-a-phone',
      start: '2026-07-10T16:00:00.000Z',
    });
    await addAppointment({
      id: 'stable-changed-phone',
      clientId: changed.id,
      phone: '6475559999',
      start: '2026-07-10T16:00:00.000Z',
    });
    await addPreMigrationAppointment({
      id: 'stale-or-foreign-id',
      clientId: foreign.id,
      phone: unique.phone,
      start: '2026-07-10T16:00:00.000Z',
    });
    await addAppointment({
      id: 'cross-salon-phone',
      phone: '+1 416 555 0404',
      start: '2026-07-10T16:00:00.000Z',
    });

    for (const [id, phone, stableId] of [
      ['outstanding-unique', '+1 (416) 555-0101', null],
      ['outstanding-duplicate', '4165550202', null],
      ['outstanding-foreign', unique.phone, foreign.id],
    ] as const) {
      await (stableId ? addPreMigrationAppointment : addAppointment)({
        id,
        clientId: stableId,
        phone,
        start: '2026-07-09T16:00:00.000Z',
        overrides: {
          finalPriceCents: 1000,
          totalPrice: 1000,
          amountPaidCents: 0,
          paymentStatus: 'partially_paid',
        },
      });
    }

    expect((await segmentIds('active')).ids).toEqual([
      'changed',
      'cross-local',
      'unique',
    ]);
    expect((await segmentIds('completed_outstanding')).ids).toEqual(['unique']);
    expect((await segmentIds('active')).ids).not.toContain('duplicate-a');
    expect((await segmentIds('active')).ids).not.toContain('duplicate-b');
  });

  it('calculates completed outstanding per eligible appointment and never nets overpayments', async () => {
    const person = await addClient('balance');
    const phone = person.phone;
    await addAppointment({
      id: 'partially-paid',
      clientId: person.id,
      phone,
      start: '2026-07-01T16:00:00.000Z',
      overrides: {
        finalPriceCents: 10000,
        taxAmountCents: 1300,
        tipCents: 500,
        amountPaidCents: 4000,
        paymentStatus: 'partially_paid',
      },
    });
    await db.insert(schema.appointmentPaymentSchema).values({
      id: 'partial-payment',
      appointmentId: 'partially-paid',
      salonId: SALON_ID,
      amountCents: 4000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-01T17:00:00.000Z'),
    });

    await addAppointment({
      id: 'overpaid',
      clientId: person.id,
      phone,
      start: '2026-07-02T16:00:00.000Z',
      overrides: {
        finalPriceCents: 1000,
        amountPaidCents: 2000,
        paymentStatus: 'paid',
      },
    });
    await db.insert(schema.appointmentPaymentSchema).values({
      id: 'overpayment',
      appointmentId: 'overpaid',
      salonId: SALON_ID,
      amountCents: 2000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-02T17:00:00.000Z'),
    });

    await addAppointment({
      id: 'voided-payment-appointment',
      clientId: person.id,
      phone,
      start: '2026-07-03T16:00:00.000Z',
      overrides: {
        finalPriceCents: 1000,
        amountPaidCents: 1000,
        paymentStatus: 'paid',
      },
    });
    await db.insert(schema.appointmentPaymentSchema).values({
      id: 'voided-payment',
      appointmentId: 'voided-payment-appointment',
      salonId: SALON_ID,
      amountCents: 1000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-03T17:00:00.000Z'),
      voidedAt: new Date('2026-07-04T17:00:00.000Z'),
    });

    const excluded = [
      ['deleted', 'completed', { deletedAt: new Date('2026-07-04T18:00:00.000Z') }],
      ['complimentary', 'completed', { paymentStatus: 'comp' }],
      ['cancelled', 'cancelled', {}],
      ['no-show', 'no_show', {}],
      ['future-completed', 'completed', {}],
      ['unresolved', 'completed', {
        finalPriceCents: 1000,
        amountPaidCents: 500,
        paymentStatus: 'partially_paid',
      }],
      ['legacy-settled', 'completed', {
        finalPriceCents: null,
        totalPrice: 1000,
        amountPaidCents: null,
        paymentStatus: 'paid',
      }],
    ] as const;
    for (const [id, status, overrides] of excluded) {
      await addAppointment({
        id,
        clientId: person.id,
        phone,
        start: id === 'future-completed'
          ? '2026-07-20T16:00:00.000Z'
          : '2026-07-04T16:00:00.000Z',
        status,
        overrides: {
          finalPriceCents: 1000,
          amountPaidCents: 0,
          paymentStatus: 'partially_paid',
          ...overrides,
        },
      });
    }

    const result = await snapshot();
    const attention = result.data.attention.items.find(
      item => item.clientId === person.id,
    );

    expect(attention?.completedOutstandingCents).toBe(8800);
    expect((await segmentIds('completed_outstanding')).ids).toEqual(['balance']);
  });

  it('keeps every count equal to filtered totals and paginates/searches in SQL', async () => {
    for (let index = 0; index < 65; index += 1) {
      const id = `overdue-${String(index).padStart(2, '0')}`;
      const person = await addClient(id, {
        fullName: index === 42 ? 'Needle Search Client' : `Overdue ${index}`,
      });
      await addAppointment({
        id: `visit-${id}`,
        clientId: id,
        phone: person.phone,
        start: '2026-06-01T16:00:00.000Z',
      });
    }

    const executeSpy = vi.spyOn(db, 'execute');
    const result = await snapshot();

    expect(executeSpy).toHaveBeenCalledTimes(1);

    executeSpy.mockClear();

    for (const segment of result.data.segments) {
      const page = await segmentIds(segment.id, { limit: 20 });

      expect(page.total, segment.id).toBe(segment.count);
    }

    expect(executeSpy).toHaveBeenCalledTimes(result.data.segments.length);

    const firstPage = await segmentIds('overdue', { page: 1, limit: 20 });
    const secondPage = await segmentIds('overdue', { page: 2, limit: 20 });
    const fourthPage = await segmentIds('overdue', { page: 4, limit: 20 });

    expect(firstPage.total).toBe(65);
    expect(firstPage.ids).toHaveLength(20);
    expect(secondPage.ids).toHaveLength(20);
    expect(fourthPage.ids).toHaveLength(5);
    expect(new Set([...firstPage.ids, ...secondPage.ids]).size).toBe(40);

    const searched = await segmentIds('overdue', {
      search: 'Needle Search',
      limit: 20,
    });

    expect(searched).toEqual({
      ids: ['overdue-42'],
      total: 1,
    });

    executeSpy.mockRestore();
  });
});
