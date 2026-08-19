/**
 * Luster L1 PR4 — §14/§15 route-level integration for EXPLICIT
 * request-approval activation. Deposit-priority precedence has its own
 * dedicated tests in `route.deposits.integration.test.ts` (which already
 * owns the deposit-mocking harness); this file covers the rest of the
 * wiring end to end against the real `POST` handler on PGlite:
 *
 *   - a request-bookable slot activates: status 'pending',
 *     `request_expires_at` + `confirmation_mode_snapshot` +
 *     `selection_mode_snapshot` written, and the customer email uses the
 *     "request received" copy (§14's email split).
 *   - a NOT request-bookable slot (no reviewable window) is refused BEFORE
 *     creating anything: 400 `REQUEST_NOT_BOOKABLE`, zero appointment rows.
 *   - LEGACY PARITY: an ordinary (non-request-approval) service on the SAME
 *     gated salon books exactly as it would with the gate off — no
 *     activation, no dark columns written.
 *   - LEGACY PARITY: the gate itself, not merely the stored
 *     `confirmation_mode` value, governs activation — a `request_approval`
 *     service on a gate-OFF salon never activates.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { zonedTimeToUtc } from '@/libs/timeZone';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  clientSession: null as null | { normalizedPhone: string; phoneVariants: string[] },
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/core/redis/redisClient', () => ({
  isRedisAvailable: vi.fn(async () => false),
  redis: null,
}));

vi.mock('@/libs/staffAuth', () => ({
  requireStaffSession: vi.fn(async () => ({ ok: false, response: new Response(null, { status: 401 }) })),
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => ({ ok: false, response: new Response(null, { status: 401 }) })),
  requireAdminSalon: vi.fn(async () => ({ salon: null, error: new Response(null, { status: 401 }) })),
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession: vi.fn(async () => {
    if (!holder.clientSession) {
      return { ok: false, response: new Response(null, { status: 401 }) };
    }
    return {
      ok: true,
      normalizedPhone: holder.clientSession.normalizedPhone,
      phoneVariants: holder.clientSession.phoneVariants,
      session: {
        phone: `+1${holder.clientSession.normalizedPhone}`,
        clientName: 'Session Client',
        sessionId: 'client_session_ra_pr4',
      },
    };
  }),
}));

vi.mock('@/libs/salonStatus', () => ({
  guardSalonApiRoute: vi.fn(async () => null),
  guardFeatureEntitlement: vi.fn(async () => null),
}));

vi.mock('@/libs/googleCalendar', () => ({
  getGoogleCalendarBusyWindows: vi.fn(async () => []),
  hasGoogleCalendarConflict: vi.fn(async () => false),
  isBusyWindowConflict: () => false,
  GoogleCalendarAvailabilityError: class GoogleCalendarAvailabilityError extends Error {
    constructor(public readonly reconnectRequired: boolean) {
      super('google_unavailable');
    }
  },
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarUpsert: vi.fn(async () => {}),
  enqueueGoogleCalendarDelete: vi.fn(async () => {}),
  enqueueGoogleCalendarAppointmentMutation: vi.fn(async () => ({ inserted: true })),
  enqueueGoogleCalendarDeleteInTx: vi.fn(async () => ({ inserted: true })),
}));

vi.mock('@/libs/googleEventReview', () => ({
  recordGoogleEventReviewDecision: vi.fn(async () => {}),
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForNewBooking: vi.fn(async () => {}),
}));

const sendTransactionalEmailDetailed = vi.hoisted(() => vi.fn());
vi.mock('@/libs/email', () => ({
  sendTransactionalEmailDetailed,
}));

vi.mock('@/libs/SMS', () => ({
  sendBookingConfirmationToClient: vi.fn(async () => ({ success: true })),
  sendRescheduleConfirmation: vi.fn(async () => ({ success: true })),
  sendCancellationNotificationToTech: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/libs/publicUrl', () => ({
  buildSalonTenantPublicUrl: vi.fn(() => 'http://localhost:3101/manage/token'),
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const TIME_ZONE = 'America/Toronto';

const GATED_SALON_ID = 'salon_ra_pr4_gated';
const GATED_SALON_SLUG = 'ra-pr4-gated-salon';
const TECH_ID = 'tech_ra_pr4';
const LOCATION_ID = 'loc_ra_pr4';
const REQUEST_SERVICE_ID = 'srv_ra_pr4_request';
const INSTANT_SERVICE_ID = 'srv_ra_pr4_instant';

const LEGACY_SALON_ID = 'salon_ra_pr4_legacy';
const LEGACY_SALON_SLUG = 'ra-pr4-legacy-salon';
const LEGACY_TECH_ID = 'tech_ra_pr4_legacy';
const LEGACY_SERVICE_ID = 'srv_ra_pr4_legacy_request'; // confirmationMode set, but the GATE is off

const FULL_WEEK = {
  sunday: { start: '9:00', end: '19:00' },
  monday: { start: '9:00', end: '19:00' },
  tuesday: { start: '9:00', end: '19:00' },
  wednesday: { start: '9:00', end: '19:00' },
  thursday: { start: '9:00', end: '19:00' },
  friday: { start: '9:00', end: '19:00' },
  saturday: { start: '9:00', end: '19:00' },
};

const OPEN_ALL_WEEK_BUSINESS_HOURS = {
  sunday: { open: '00:00', close: '23:59' },
  monday: { open: '00:00', close: '23:59' },
  tuesday: { open: '00:00', close: '23:59' },
  wednesday: { open: '00:00', close: '23:59' },
  thursday: { open: '00:00', close: '23:59' },
  friday: { open: '00:00', close: '23:59' },
  saturday: { open: '00:00', close: '23:59' },
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let counter = 0;

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

function futureDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function signInFreshClient(): void {
  counter += 1;
  const phone = `416780${String(1000 + counter).padStart(4, '0')}`;
  holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };
}

async function postBooking(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function appointmentRowsFor(salonId: string) {
  return db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, salonId));
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: GATED_SALON_ID,
      name: 'RA PR4 Gated Salon',
      slug: GATED_SALON_SLUG,
      features: { catalog: { variantsV1: false, addOnGroupsV1: false, bookingModesV1: true } },
    },
    {
      id: LEGACY_SALON_ID,
      name: 'RA PR4 Legacy Salon',
      slug: LEGACY_SALON_SLUG,
      features: null, // gate OFF
    },
  ]);

  await db.insert(schema.technicianSchema).values([
    { id: TECH_ID, salonId: GATED_SALON_ID, name: 'Nadia', weeklySchedule: FULL_WEEK },
    { id: LEGACY_TECH_ID, salonId: LEGACY_SALON_ID, name: 'Nadia Legacy', weeklySchedule: FULL_WEEK },
  ]);

  await db.insert(schema.salonLocationSchema).values({
    id: LOCATION_ID,
    salonId: GATED_SALON_ID,
    name: 'Main',
    isPrimary: true,
    businessHours: OPEN_ALL_WEEK_BUSINESS_HOURS,
  });

  await db.insert(schema.serviceSchema).values([
    {
      id: REQUEST_SERVICE_ID,
      salonId: GATED_SALON_ID,
      name: 'Ombré Request Set',
      category: 'manicure',
      price: 5000,
      durationMinutes: 60,
      confirmationMode: 'request_approval',
    },
    {
      id: INSTANT_SERVICE_ID,
      salonId: GATED_SALON_ID,
      name: 'Classic Manicure',
      category: 'manicure',
      price: 4500,
      durationMinutes: 45,
      // confirmationMode NOT set — ordinary legacy/instant service, on the SAME gated salon.
    },
    {
      id: LEGACY_SERVICE_ID,
      salonId: LEGACY_SALON_ID,
      name: 'Ombré Request Set (legacy salon)',
      category: 'manicure',
      price: 5000,
      durationMinutes: 60,
      confirmationMode: 'request_approval', // set on the row, but the SALON'S gate is off
    },
  ]);

  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: TECH_ID, serviceId: REQUEST_SERVICE_ID, enabled: true },
    { technicianId: TECH_ID, serviceId: INSTANT_SERVICE_ID, enabled: true },
    { technicianId: LEGACY_TECH_ID, serviceId: LEGACY_SERVICE_ID, enabled: true },
  ]);
}, 60_000);

beforeEach(() => {
  holder.clientSession = null;
  vi.clearAllMocks();
  sendTransactionalEmailDetailed.mockResolvedValue({ ok: true, errorCode: null, providerMessageId: 'msg_ra' });
});

afterAll(async () => {
  await client.close();
});

describe('explicit request-approval activation — happy path', () => {
  it('a request-bookable slot activates: pending status, dark columns written, and the "request received" email is sent', async () => {
    // A GUEST booking with a real email on file — the customer confirmation
    // email's recipient resolves from the stored client identity, which a
    // bare `signInFreshClient()` session (phone only) does not provide.
    counter += 1;
    const guestPhone = `416781${String(1000 + counter).padStart(4, '0')}`;

    const response = await postBooking({
      salonSlug: GATED_SALON_SLUG,
      baseServiceId: REQUEST_SERVICE_ID,
      technicianId: TECH_ID,
      locationId: LOCATION_ID,
      startTime: at(futureDate(10), '10:00').toISOString(),
      clientPhone: guestPhone,
      clientName: 'Priya Guest',
      clientEmail: `priya.guest.${counter}@example.com`,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.appointmentId).toBeTruthy();

    const [row] = await appointmentRowsFor(GATED_SALON_ID);

    expect(row?.status).toBe('pending');
    expect(row?.requestExpiresAt).not.toBeNull();
    expect(row?.confirmationModeSnapshot).toBe('request_approval');
    // requestExpiresAt must be strictly before the appointment's own startTime.
    expect(row!.requestExpiresAt!.getTime()).toBeLessThan(row!.startTime.getTime());

    const emailCall = sendTransactionalEmailDetailed.mock.calls.find(
      call => typeof call[0]?.subject === 'string' && call[0].subject.includes('request received'),
    );

    expect(emailCall).toBeTruthy();
    expect(emailCall![0].text).toContain('We\'ve received your request for');
  });
});

describe('explicit request-approval activation — not request-bookable', () => {
  it('rejects BEFORE creating anything when there is no reviewable window (400 REQUEST_NOT_BOOKABLE, zero appointment rows)', async () => {
    signInFreshClient();
    const before = await appointmentRowsFor(GATED_SALON_ID);

    // A second location with NO business hours at all — technician schedule
    // (FULL_WEEK) still permits the slot, but the review-window source is
    // empty, so the deadline algorithm must fail closed.
    const closedLocationId = 'loc_ra_pr4_closed';
    await db.insert(schema.salonLocationSchema).values({
      id: closedLocationId,
      salonId: GATED_SALON_ID,
      name: 'No Hours Branch',
      isPrimary: false,
      businessHours: null,
    });

    const response = await postBooking({
      salonSlug: GATED_SALON_SLUG,
      baseServiceId: REQUEST_SERVICE_ID,
      technicianId: TECH_ID,
      locationId: closedLocationId,
      startTime: at(futureDate(11), '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('REQUEST_NOT_BOOKABLE');

    const after = await appointmentRowsFor(GATED_SALON_ID);

    expect(after).toHaveLength(before.length);
  });
});

describe('explicit request-approval activation — LEGACY PARITY', () => {
  it('an ordinary (non-request-approval) service on the SAME gated salon books exactly as before: no dark columns written', async () => {
    signInFreshClient();

    const response = await postBooking({
      salonSlug: GATED_SALON_SLUG,
      baseServiceId: INSTANT_SERVICE_ID,
      technicianId: TECH_ID,
      locationId: LOCATION_ID,
      startTime: at(futureDate(12), '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const rows = await appointmentRowsFor(GATED_SALON_ID);
    const row = rows.find(r => r.id === body.data.appointmentId);

    expect(row?.status).toBe('pending'); // freeSoloEnabled is false by default — same as any legacy salon
    expect(row?.requestExpiresAt).toBeNull();
    expect(row?.confirmationModeSnapshot).toBeNull();
    expect(row?.selectionModeSnapshot).toBeNull();
  });

  it('the GATE, not merely the stored confirmation_mode value, governs activation — a request_approval service on a gate-OFF salon never activates', async () => {
    signInFreshClient();

    const response = await postBooking({
      salonSlug: LEGACY_SALON_SLUG,
      baseServiceId: LEGACY_SERVICE_ID,
      technicianId: LEGACY_TECH_ID,
      startTime: at(futureDate(13), '10:00').toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(201);

    const rows = await appointmentRowsFor(LEGACY_SALON_ID);
    const row = rows.find(r => r.id === body.data.appointmentId);

    // Would be 'pending' with request_expires_at set if the gate wrongly
    // activated — instead it is legacy 'pending' with everything dark unset,
    // proving `resolveCatalogDomainView` (not the raw column) is the gate.
    expect(row?.status).toBe('pending');
    expect(row?.requestExpiresAt).toBeNull();
    expect(row?.confirmationModeSnapshot).toBeNull();
  });
});
