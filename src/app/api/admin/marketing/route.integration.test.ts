/**
 * Marketing overview integration (PGlite, real SQL): follow-up groups reuse
 * the live retention engine (future bookings excluded), consent is surfaced
 * honestly, and Results use finalized appointment values — tax excluded from
 * revenue, comp rows at zero, nothing invented.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
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
  ]);
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
  it('groups follow-ups from the live engine, excludes future bookings, and surfaces consent + last service', async () => {
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
