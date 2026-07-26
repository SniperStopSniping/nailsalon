/**
 * Marketing overview integration (PGlite, real SQL): follow-up groups reuse
 * the live retention engine (future bookings excluded), consent is surfaced
 * honestly, and Results use finalized appointment values — tax excluded from
 * revenue, comp rows at zero, nothing invented.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { GET } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown, authorized: true }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async (slug: string) => {
    if (!holder.authorized || slug !== 'marketing-salon') {
      return {
        salon: null,
        error: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }),
      };
    }
    return { salon: { id: 'salon_mkt', slug }, error: null };
  }),
}));

const SALON_ID = 'salon_mkt';
const DAY = 86_400_000;

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  const now = Date.now();
  await db.insert(schema.salonSchema).values({ id: SALON_ID, name: 'Marketing Salon', slug: 'marketing-salon' });
  await db.insert(schema.salonClientSchema).values([
    // 45 days since last visit → win-back stage 1; has transactional consent.
    { id: 'sc_due', salonId: SALON_ID, phone: '4165550301', fullName: 'Due Client', lastVisitAt: new Date(now - 45 * DAY) },
    // Same staleness but has a FUTURE booking → must be excluded.
    { id: 'sc_booked', salonId: SALON_ID, phone: '4165550302', fullName: 'Booked Client', lastVisitAt: new Date(now - 45 * DAY) },
    // Archived standalone profiles are historical records, never outreach candidates.
    {
      id: 'sc_archived',
      salonId: SALON_ID,
      phone: '4165550303',
      fullName: 'Archived Client',
      lastVisitAt: new Date(now - 45 * DAY),
      archivedAt: new Date(now - DAY),
      archivedBy: 'archive-test',
    },
    // Due, but an older active communication state must still suppress it even
    // when newer archived history exceeds the operational query cap.
    {
      id: 'sc_suppressed',
      salonId: SALON_ID,
      phone: '4165550306',
      fullName: 'Suppressed Client',
      lastVisitAt: new Date(now - 45 * DAY),
    },
    // Due, but a communication on the merged source below must suppress this
    // terminal after SQL canonicalizes the source to its active primary.
    {
      id: 'sc_terminal',
      salonId: SALON_ID,
      phone: '4165550304',
      fullName: 'Terminal Client',
      lastVisitAt: new Date(now - 45 * DAY),
    },
    { id: 'sc_merged_source', salonId: SALON_ID, phone: '4165550305', fullName: 'Merged Source', lastVisitAt: new Date(now - 45 * DAY) },
    {
      id: 'sc_appt_terminal',
      salonId: SALON_ID,
      phone: '4165550307',
      fullName: 'Appointment Terminal',
      lastVisitAt: new Date(now - 45 * DAY),
    },
    {
      id: 'sc_appt_source',
      salonId: SALON_ID,
      phone: '4165550308',
      fullName: 'Appointment Source',
      lastVisitAt: new Date(now - 45 * DAY),
    },
    ...Array.from({ length: 17 }, (_, index) => ({
      id: `sc_deep_${index}`,
      salonId: SALON_ID,
      phone: `417${String(index).padStart(7, '0')}`,
      fullName: `Invalid depth ${index}`,
      lastVisitAt: index === 0 ? new Date(now - 45 * DAY) : null,
    })),
  ]);
  await db.execute(sql.raw(
    'ALTER TABLE salon_client DISABLE TRIGGER salon_client_enforce_merge_transition',
  ));
  try {
    await db.execute(sql.raw(`
      UPDATE salon_client
      SET archived_at = now(),
          archived_by = 'merge-test',
          merged_into_client_id = CASE
            WHEN id = 'sc_merged_source' THEN 'sc_terminal'
            ELSE 'sc_appt_terminal'
          END,
          merged_at = now(),
          merged_by = 'merge-test'
      WHERE id IN ('sc_merged_source', 'sc_appt_source')
    `));
    await db.execute(sql.raw(`
      UPDATE salon_client AS source
      SET archived_at = now(),
          archived_by = 'merge-test',
          merged_into_client_id = 'sc_deep_' || (deep.value - 1)::text,
          merged_at = now(),
          merged_by = 'merge-test'
      FROM generate_series(1, 16) AS deep(value)
      WHERE source.id = 'sc_deep_' || deep.value::text
    `));
  } finally {
    await db.execute(sql.raw(
      'ALTER TABLE salon_client ENABLE TRIGGER salon_client_enforce_merge_transition',
    ));
  }
  await db.insert(schema.communicationConsentSchema).values({
    id: 'consent_1',
    salonId: SALON_ID,
    recipient: '4165550301',
    channel: 'sms',
    purpose: 'appointment_transactional',
    status: 'granted',
    wordingVersion: 'v1',
    source: 'public_booking',
  });
  await db.insert(schema.clientCommunicationSchema).values([
    {
      id: 'comm_active_suppression',
      salonId: SALON_ID,
      salonClientId: 'sc_suppressed',
      kind: 'promo_6w',
      status: 'snoozed',
      snoozedUntil: new Date(now + 7 * DAY),
      createdAt: new Date(now - 2 * DAY),
      updatedAt: new Date(now - 2 * DAY),
    },
    {
      id: 'comm_merged_source_suppression',
      salonId: SALON_ID,
      salonClientId: 'sc_merged_source',
      kind: 'promo_6w',
      status: 'snoozed',
      snoozedUntil: new Date(now + 7 * DAY),
      createdAt: new Date(now - 2 * DAY),
      updatedAt: new Date(now - 2 * DAY),
    },
  ]);
  await db.execute(sql`
    insert into client_communication (
      id,
      salon_id,
      salon_client_id,
      kind,
      status,
      created_at,
      updated_at
    )
    select
      'comm_archived_noise_' || noise.value::text,
      ${SALON_ID},
      'sc_archived',
      'rebook',
      'marked_sent',
      ${new Date(now - DAY)},
      ${new Date(now - DAY)}
    from generate_series(1, 10000) as noise(value)
  `);
  await db.insert(schema.appointmentSchema).values([
    // Last completed visit for sc_due — provides "last service" via snapshot.
    {
      id: 'appt_last',
      salonId: SALON_ID,
      salonClientId: 'sc_due',
      clientPhone: '4165550301',
      startTime: new Date(now - 45 * DAY),
      endTime: new Date(now - 45 * DAY + 3_600_000),
      status: 'completed',
      completedAt: new Date(now - 45 * DAY),
      totalPrice: 5000,
      totalDurationMinutes: 60,
    },
    // Future booking that suppresses sc_booked.
    {
      id: 'appt_future',
      salonId: SALON_ID,
      salonClientId: 'sc_booked',
      clientPhone: '4165550302',
      startTime: new Date(now + 2 * DAY),
      endTime: new Date(now + 2 * DAY + 3_600_000),
      status: 'confirmed',
      totalPrice: 5000,
      totalDurationMinutes: 60,
    },
    // A valid stale source ID must canonicalize to the active terminal before
    // the bounded appointment input reaches the retention engine.
    {
      id: 'appt_future_merged_source',
      salonId: SALON_ID,
      salonClientId: 'sc_appt_source',
      clientPhone: '4165550308',
      startTime: new Date(now + 3 * DAY),
      endTime: new Date(now + 3 * DAY + 3_600_000),
      status: 'confirmed',
      totalPrice: 5000,
      totalDurationMinutes: 60,
    },
    // Campaign-redeemed appointment, completed via checkout: final 10000,
    // tax 1300 — revenue must report 10000, tax separately.
    {
      id: 'appt_redeemed',
      salonId: SALON_ID,
      salonClientId: 'sc_due',
      clientPhone: '4165550301',
      startTime: new Date(now - 5 * DAY),
      endTime: new Date(now - 5 * DAY + 3_600_000),
      status: 'completed',
      completedAt: new Date(now - 5 * DAY),
      totalPrice: 11000,
      totalDurationMinutes: 60,
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      paymentStatus: 'paid',
    },
  ]);
  await db.insert(schema.serviceSchema).values({
    id: 'svc_x',
    salonId: SALON_ID,
    name: 'Gel Manicure',
    category: 'manicure',
    price: 5000,
    durationMinutes: 60,
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: 'as_last',
    appointmentId: 'appt_last',
    serviceId: 'svc_x',
    priceAtBooking: 5000,
    durationAtBooking: 60,
    nameSnapshot: 'Gel Manicure',
  });
  await db.insert(schema.retentionCampaignSchema).values([
    {
      id: 'camp_1',
      salonId: SALON_ID,
      salonClientId: 'sc_due',
      tokenHash: 'hash_1',
      stage: 'promo_6w',
      promotionSnapshot: { enabled: true, name: 'We miss you', discountType: 'percent', value: 10, eligibleServiceIds: [], expiryDays: 14, code: null, messageTemplate: 'x {bookingLink}', singleUse: true },
      expiresAt: new Date(now + 14 * DAY),
      singleUse: true,
      redeemedAt: new Date(now - 5 * DAY),
      redeemedAppointmentId: 'appt_redeemed',
    },
    {
      id: 'camp_2',
      salonId: SALON_ID,
      salonClientId: 'sc_due',
      tokenHash: 'hash_2',
      stage: 'promo_6w',
      promotionSnapshot: { enabled: true, name: 'We miss you', discountType: 'percent', value: 10, eligibleServiceIds: [], expiryDays: 14, code: null, messageTemplate: 'x {bookingLink}', singleUse: true },
      expiresAt: new Date(now + 14 * DAY),
      singleUse: true,
    },
  ]);
  await db.insert(schema.retentionCampaignRedemptionSchema).values({
    id: 'red_1',
    salonId: SALON_ID,
    campaignId: 'camp_1',
    appointmentId: 'appt_redeemed',
    discountAmountCents: 1000,
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

function marketingRequest(slug = 'marketing-salon') {
  return new Request(`http://localhost/api/admin/marketing?salonSlug=${slug}`);
}

describe('GET /api/admin/marketing', () => {
  it('groups active follow-ups, excludes archived/merged clients and future bookings, and surfaces consent + last service', async () => {
    const response = await GET(marketingRequest());
    const body = await response.json();

    expect(response.status).toBe(200);

    const stage1 = body.data.followups.groups.find((group: { id: string }) => group.id === 'promo_6w');

    expect(stage1.items).toHaveLength(1);
    expect(stage1.items[0]).toMatchObject({
      clientId: 'sc_due',
      clientName: 'Due Client',
      lastServiceName: 'Gel Manicure',
      hasUpcomingAppointment: false,
      smsConsent: true,
      channel: 'manual_text',
    });

    // The stale client with a future booking never appears in ANY group.
    const allItems = body.data.followups.groups.flatMap((group: { items: Array<{ clientId: string }> }) => group.items);

    expect(allItems.some((item: { clientId: string }) => item.clientId === 'sc_booked')).toBe(false);
    expect(allItems.some((item: { clientId: string }) => item.clientId === 'sc_archived')).toBe(false);
    expect(allItems.some((item: { clientId: string }) => item.clientId === 'sc_suppressed')).toBe(false);
    expect(allItems.some((item: { clientId: string }) => item.clientId === 'sc_terminal')).toBe(false);
    expect(allItems.some((item: { clientId: string }) => item.clientId === 'sc_merged_source')).toBe(false);
    expect(allItems.some((item: { clientId: string }) => item.clientId === 'sc_appt_terminal')).toBe(false);
    expect(allItems.some((item: { clientId: string }) => item.clientId === 'sc_appt_source')).toBe(false);
    expect(allItems.some((item: { clientId: string }) => item.clientId === 'sc_deep_0')).toBe(false);
  });

  it('reports campaign results from finalized values — tax separated, never counted as revenue', async () => {
    const response = await GET(marketingRequest());
    const body = await response.json();

    const stage = body.data.results.campaigns.find((row: { stage: string }) => row.stage === 'promo_6w');

    expect(stage).toMatchObject({
      minted: 2,
      redeemed: 1,
      discountGivenCents: 1000,
      completedCount: 1,
      // finalPriceCents (10000), NOT totalPrice (11000) and NOT final+tax.
      completedRevenueCents: 10000,
      completedTaxCents: 1300,
    });
  });

  it('enforces admin tenancy server-side', async () => {
    const response = await GET(marketingRequest('someone-elses-salon'));

    expect(response.status).toBe(403);
  });
});
