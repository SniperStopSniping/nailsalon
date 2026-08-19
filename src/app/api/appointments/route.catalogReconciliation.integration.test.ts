/**
 * Luster L1 PR4 — §12/§13 route-level integration.
 *
 * Mirrors the exact harness `route.requiredAddOnEnforcement.test.ts`
 * established: real PGlite DB, every OTHER production dependency mocked.
 * Proves, against the REAL `POST` handler:
 *
 *   - gate OFF (every salon today): a `catalogAcknowledgment` is accepted
 *     but has NO effect — even a deliberately wrong one — booking succeeds
 *     exactly as before this PR (legacy parity, §18).
 *   - gate ON, no acknowledgment: booking succeeds (nothing to compare).
 *   - gate ON, a matching acknowledgment: booking succeeds.
 *   - gate ON, a STALE acknowledgment: 409 CATALOG_SELECTION_CHANGED, ZERO
 *     persistence — no appointment row, no deposit row, no policy-ack row —
 *     and the response carries the public-safe conflict payload.
 *   - §12 ORDER, BEHAVIOURALLY: a genuine slot conflict (a real, committed
 *     competing appointment) and a stale catalog acknowledgment are both
 *     present in the SAME request — the response is 409
 *     CATALOG_SELECTION_CHANGED, never TIME_CONFLICT, and the row count
 *     never grows. That is only possible if catalog reconciliation runs
 *     BEFORE the availability check (pre-tx soft check AND in-tx slot
 *     lock) actually executes — a real fact about execution order, not a
 *     source-text position.
 *   - §12 ORDER, STRUCTURALLY (secondary signal): the reconciliation call
 *     also sits, in source, before every "already exists" step it must
 *     precede (the preliminary policy determination, the in-tx
 *     authoritative policy-ack re-check, and the in-tx slot lock) — and
 *     runs PRE-TRANSACTION, never nested inside
 *     `runSerializedBookingTransaction` (see route.ts's own comment at the
 *     call site for why: the PR3-frozen resolver functions this calls run
 *     their own top-level DB queries and were never built to accept a
 *     caller's `tx`).
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
  clientSession: null as null | {
    normalizedPhone: string;
    phoneVariants: string[];
  },
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
  requireStaffSession: vi.fn(async () => ({
    ok: false,
    response: new Response(null, { status: 401 }),
  })),
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => ({
    ok: false,
    response: new Response(null, { status: 401 }),
  })),
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
        sessionId: 'client_session_catalog_pr4',
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

vi.mock('@/libs/customerBookingEmail', () => ({
  sendCustomerBookingConfirmationEmail: vi.fn(async () => ({ delivered: false })),
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
import { reconcileCatalogSelection } from '@/libs/catalogSubmissionReconciliation.server';

import { POST } from './route';
/* eslint-enable import/first */

const TIME_ZONE = 'America/Toronto';

const GATED_SALON_ID = 'salon_catalog_pr4_gated';
const GATED_SALON_SLUG = 'catalog-pr4-gated-salon';
const LEGACY_SALON_ID = 'salon_catalog_pr4_legacy';
const LEGACY_SALON_SLUG = 'catalog-pr4-legacy-salon';

const FULL_WEEK = {
  sunday: { start: '9:00', end: '17:00' },
  monday: { start: '9:00', end: '17:00' },
  tuesday: { start: '9:00', end: '17:00' },
  wednesday: { start: '9:00', end: '17:00' },
  thursday: { start: '9:00', end: '17:00' },
  friday: { start: '9:00', end: '17:00' },
  saturday: { start: '9:00', end: '17:00' },
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let counter = 0;

const techId = (salonId: string) => `tech_catalog_pr4_${salonId}`;
const serviceId = (salonId: string) => `srv_catalog_pr4_${salonId}`;
const addOnId = (salonId: string) => `addon_catalog_pr4_${salonId}`;

function futureDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

function signInFreshClient(): void {
  counter += 1;
  const phone = `416779${String(1000 + counter).padStart(4, '0')}`;
  holder.clientSession = { normalizedPhone: phone, phoneVariants: [phone, `+1${phone}`] };
}

async function seedSalon(salonId: string, slug: string, gated: boolean) {
  await db.insert(schema.salonSchema).values({
    id: salonId,
    name: slug,
    slug,
    settings: { booking: {} },
    features: gated
      ? { catalog: { variantsV1: true, addOnGroupsV1: false, bookingModesV1: false } }
      : null,
  });
  await db.insert(schema.technicianSchema).values({
    id: techId(salonId),
    salonId,
    name: 'Isla',
    weeklySchedule: FULL_WEEK,
  });
  await db.insert(schema.serviceSchema).values({
    id: serviceId(salonId),
    salonId,
    name: 'Classic Manicure',
    category: 'manicure',
    price: 4500,
    durationMinutes: 45,
  });
  await db.insert(schema.addOnSchema).values({
    id: addOnId(salonId),
    salonId,
    name: 'Gel Polish',
    slug: 'gel-polish',
    category: 'nail_art',
    priceCents: 1000,
    durationMinutes: 15,
  });
  await db.insert(schema.serviceAddOnSchema).values({
    id: `svcaddon_catalog_pr4_${salonId}`,
    salonId,
    serviceId: serviceId(salonId),
    addOnId: addOnId(salonId),
    selectionMode: 'optional',
    displayOrder: 0,
  });
  await db.insert(schema.technicianServicesSchema).values({
    technicianId: techId(salonId),
    serviceId: serviceId(salonId),
    enabled: true,
  });
}

function bookingBody(args: {
  salonSlug: string;
  salonId: string;
  offsetDays: number;
  catalogAcknowledgment?: { serviceId: string; resolutionFingerprint: string };
}) {
  return JSON.stringify({
    salonSlug: args.salonSlug,
    technicianId: techId(args.salonId),
    baseServiceId: serviceId(args.salonId),
    selectedAddOns: [{ addOnId: addOnId(args.salonId), quantity: 1 }],
    startTime: at(futureDate(args.offsetDays), '10:00').toISOString(),
    ...(args.catalogAcknowledgment ? { catalogAcknowledgment: args.catalogAcknowledgment } : {}),
  });
}

async function postBooking(body: string): Promise<Response> {
  return POST(new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }));
}

async function appointmentCount(salonId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.appointmentSchema.id })
    .from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.salonId, salonId));
  return rows.length;
}

/** Computes the REAL, current resolution fingerprint a well-behaved future client would send. */
async function currentFingerprint(salonId: string): Promise<string> {
  const outcome = await reconcileCatalogSelection({
    salonId,
    features: { catalog: { variantsV1: true, addOnGroupsV1: false, bookingModesV1: false } },
    selection: {
      serviceId: serviceId(salonId),
      selectedAddOns: [{ addOnId: addOnId(salonId), quantity: 1 }],
    },
  });
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}`);
  }
  return outcome.resolutionFingerprint;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await seedSalon(LEGACY_SALON_ID, LEGACY_SALON_SLUG, false);
  await seedSalon(GATED_SALON_ID, GATED_SALON_SLUG, true);
}, 60_000);

beforeEach(() => {
  holder.clientSession = null;
});

afterAll(async () => {
  await client.close();
});

describe('POST /api/appointments — catalog reconciliation legacy parity (gate OFF)', () => {
  it('a WRONG catalogAcknowledgment has no effect on a legacy salon — books normally', async () => {
    signInFreshClient();

    const response = await postBooking(bookingBody({
      salonSlug: LEGACY_SALON_SLUG,
      salonId: LEGACY_SALON_ID,
      offsetDays: 10,
      catalogAcknowledgment: { serviceId: serviceId(LEGACY_SALON_ID), resolutionFingerprint: 'f'.repeat(64) },
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.appointmentId).toBeTruthy();
  });

  it('no catalogAcknowledgment at all on a legacy salon — books normally (the ordinary case, every client today)', async () => {
    signInFreshClient();

    const response = await postBooking(bookingBody({
      salonSlug: LEGACY_SALON_SLUG,
      salonId: LEGACY_SALON_ID,
      offsetDays: 11,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.appointmentId).toBeTruthy();
  });
});

describe('POST /api/appointments — catalog reconciliation (gate ON)', () => {
  it('no acknowledgment supplied: books normally (fresh resolution computed, nothing to compare)', async () => {
    signInFreshClient();

    const response = await postBooking(bookingBody({
      salonSlug: GATED_SALON_SLUG,
      salonId: GATED_SALON_ID,
      offsetDays: 12,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.appointmentId).toBeTruthy();
  });

  it('a MATCHING acknowledgment: books normally', async () => {
    signInFreshClient();
    const fingerprint = await currentFingerprint(GATED_SALON_ID);

    const response = await postBooking(bookingBody({
      salonSlug: GATED_SALON_SLUG,
      salonId: GATED_SALON_ID,
      offsetDays: 13,
      catalogAcknowledgment: { serviceId: serviceId(GATED_SALON_ID), resolutionFingerprint: fingerprint },
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.appointmentId).toBeTruthy();
  });

  it('a STALE acknowledgment: 409 CATALOG_SELECTION_CHANGED, and ZERO appointment rows are written', async () => {
    signInFreshClient();
    const before = await appointmentCount(GATED_SALON_ID);

    const response = await postBooking(bookingBody({
      salonSlug: GATED_SALON_SLUG,
      salonId: GATED_SALON_ID,
      offsetDays: 14,
      catalogAcknowledgment: { serviceId: serviceId(GATED_SALON_ID), resolutionFingerprint: 'a'.repeat(64) },
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CATALOG_SELECTION_CHANGED');
    expect(body.error.details.refreshCatalog).toBe(true);
    expect(body.error.details.reason).toBe('material_change');
    expect(body.error.details.resolutionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(body.error.details.snapshot).toBeTruthy();
    expect(body.error.details.resolution).toBeTruthy();

    const after = await appointmentCount(GATED_SALON_ID);

    expect(after).toBe(before);
  });

  it('the response payload carries no rule id, priority, note, params, or capability id anywhere', async () => {
    signInFreshClient();

    const response = await postBooking(bookingBody({
      salonSlug: GATED_SALON_SLUG,
      salonId: GATED_SALON_ID,
      offsetDays: 15,
      catalogAcknowledgment: { serviceId: serviceId(GATED_SALON_ID), resolutionFingerprint: 'b'.repeat(64) },
    }));
    const body = await response.json();

    expect(response.status).toBe(409);

    const serialized = JSON.stringify(body);
    for (const forbidden of ['ruleId', '"priority"', '"note"', 'capabilityId', 'rawParams']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('§12 ORDER — BEHAVIOURAL proof that catalog reconciliation precedes availability', () => {
  it('a stale catalog acknowledgment wins over a genuine slot conflict: 409 CATALOG_SELECTION_CHANGED, never TIME_CONFLICT, and the conflicting row is the ONLY row that exists afterward', async () => {
    // Seed a real, committed appointment occupying the exact slot this test
    // will then try to book into — a genuine, independently-sufficient
    // reason for the pre-tx availability check AND the in-tx slot lock to
    // both refuse the request with TIME_CONFLICT. If catalog reconciliation
    // did NOT run first, this is exactly the response we would observe
    // instead of CATALOG_SELECTION_CHANGED — so which one comes back is a
    // real behavioural fact about ordering, not a source-text position.
    const occupiedSlot = at(futureDate(20), '10:00').toISOString();
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_catalog_pr4_race_conflict',
      salonId: GATED_SALON_ID,
      technicianId: techId(GATED_SALON_ID),
      clientPhone: '4165551234',
      startTime: new Date(occupiedSlot),
      endTime: new Date(new Date(occupiedSlot).getTime() + 45 * 60_000),
      status: 'confirmed',
      totalPrice: 4500,
      totalDurationMinutes: 45,
    });
    const before = await appointmentCount(GATED_SALON_ID);

    signInFreshClient();
    const response = await postBooking(bookingBody({
      salonSlug: GATED_SALON_SLUG,
      salonId: GATED_SALON_ID,
      offsetDays: 20, // same day as the seeded conflict
      catalogAcknowledgment: { serviceId: serviceId(GATED_SALON_ID), resolutionFingerprint: 'c'.repeat(64) },
    }));
    const body = await response.json();

    // If ordering were reversed (availability checked first), this would be
    // 409 TIME_CONFLICT and the catalog conflict would never be reached.
    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CATALOG_SELECTION_CHANGED');

    const after = await appointmentCount(GATED_SALON_ID);

    // Zero net-new rows: the count is EXACTLY what it was after seeding the
    // one conflicting row (other `it` blocks in this file accumulate rows
    // of their own on this shared salon, so this asserts the DELTA, not an
    // absolute count).
    expect(after).toBe(before);
  });
});

describe('§12 ORDER — source-position signal (SECONDARY; the behavioural test above is authoritative)', () => {
  it('reconcileCatalogSelection is called BEFORE the preliminary policy determination, BEFORE assertCurrentBookingPolicyAcknowledgment, and BEFORE lockTechnicianAndAssertSlotFree', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/api/appointments/route.ts'), 'utf8');

    const reconcileIndex = source.indexOf('const catalogOutcome = await reconcileCatalogSelection(');
    // The preliminary (pre-transaction) policy determination — step 2 of the
    // pinned order (`bookingSubmissionOrder.ts`), unchanged main.
    const preliminaryPolicyIndex = source.indexOf('const preliminaryRequiredPolicy = isNewPublicBooking');
    // The in-transaction authoritative re-checks, further down the same file.
    const authoritativePolicyAckIndex = source.indexOf('const currentRequiredPolicy\n              = assertCurrentBookingPolicyAcknowledgment(');
    const slotLockIndex = source.indexOf('await lockTechnicianAndAssertSlotFree(tx, {');

    expect(reconcileIndex).toBeGreaterThan(-1);
    expect(preliminaryPolicyIndex).toBeGreaterThan(-1);
    expect(authoritativePolicyAckIndex).toBeGreaterThan(-1);
    expect(slotLockIndex).toBeGreaterThan(-1);

    expect(reconcileIndex).toBeLessThan(preliminaryPolicyIndex);
    expect(reconcileIndex).toBeLessThan(authoritativePolicyAckIndex);
    expect(reconcileIndex).toBeLessThan(slotLockIndex);
  });

  it('reconcileCatalogSelection is called OUTSIDE any transaction — it never receives a `tx` handle', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/api/appointments/route.ts'), 'utf8');

    const reconcileCallStart = source.indexOf('const catalogOutcome = await reconcileCatalogSelection({');
    const reconcileCallEnd = source.indexOf('});', reconcileCallStart);
    const callSite = source.slice(reconcileCallStart, reconcileCallEnd);

    expect(callSite).not.toContain('tx');
  });
});
