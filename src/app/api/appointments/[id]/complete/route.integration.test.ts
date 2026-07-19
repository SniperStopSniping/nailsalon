/**
 * Checkout integration tests — real SQL on a dedicated PGlite with the full
 * migration set (incl. 0058), exercising the actual route handlers for
 * completion, payment recording, voiding, and reopening. Auth guards are
 * stubbed (unit-tested elsewhere); everything below them is real.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { POST as voidPayment } from '../payments/[paymentId]/void/route';
import { POST as recordPayment } from '../payments/route';
import { POST as reopenAppointment } from '../reopen/route';
import { PATCH as completePatch } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  access: null as unknown,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess: vi.fn(async (appointmentId: string) => {
    const accessConfig = holder.access as {
      actorRole: 'staff' | 'admin';
      technicianId?: string;
      salonId: string;
    };
    const db = holder.db as ReturnType<typeof drizzle<typeof schema>>;
    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId))
      .limit(1);
    if (!appointment) {
      return {
        ok: false,
        response: Response.json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'not found' } }, { status: 404 }),
      };
    }
    if (accessConfig.actorRole === 'staff') {
      return {
        ok: true,
        actorRole: 'staff',
        session: {
          technicianId: accessConfig.technicianId ?? 'tech_checkout',
          technicianName: 'Integration Tech',
          salonId: accessConfig.salonId,
          salonSlug: 'checkout-salon',
          phone: '4165550100',
        },
        appointment,
      };
    }
    return {
      ok: true,
      actorRole: 'admin',
      admin: { id: 'admin_checkout', name: 'Integration Admin' },
      appointment,
    };
  }),
}));

const { evaluateAndFlagIfNeeded } = vi.hoisted(() => ({
  evaluateAndFlagIfNeeded: vi.fn(async () => undefined),
}));

vi.mock('@/libs/fraudDetection', () => ({
  evaluateAndFlagIfNeeded,
}));

const SALON_ID = 'salon_checkout';
const TAX_SALON_ID = 'salon_checkout_tax';
const TECH_ID = 'tech_checkout';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let appointmentCounter = 0;

async function seedAppointment(overrides: Partial<typeof schema.appointmentSchema.$inferInsert> = {}) {
  appointmentCounter += 1;
  const id = `appt_chk_${appointmentCounter}`;
  // Distinct slots per appointment — the 0054 anti-double-booking constraint
  // is unique on (technician, start slot) for active statuses.
  const startTime = new Date(Date.UTC(2026, 6, 1 + appointmentCounter, 14, 0, 0));
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: '4165550111',
    clientName: 'Checkout Client',
    startTime,
    endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
    status: 'confirmed',
    totalPrice: 4500,
    totalDurationMinutes: 60,
    ...overrides,
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: `apptSvc_${id}`,
    appointmentId: id,
    serviceId: 'svc_checkout_biab',
    priceAtBooking: 4500,
    durationAtBooking: 60,
    nameSnapshot: 'BIAB Short',
    priceCentsSnapshot: 4500,
    durationMinutesSnapshot: 60,
  });
  return id;
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/appointments/x/complete', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function addAfterPhoto(appointmentId: string) {
  await db.insert(schema.appointmentPhotoSchema).values({
    id: `photo_${appointmentId}`,
    appointmentId,
    salonId: SALON_ID,
    normalizedClientPhone: '4165550111',
    photoType: 'after',
    cloudinaryPublicId: `pub_${appointmentId}`,
    imageUrl: `https://img.test/${appointmentId}.jpg`,
  });
}

async function loadAppointment(id: string) {
  const [row] = await db
    .select()
    .from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, id))
    .limit(1);
  return row!;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Checkout Salon', slug: 'checkout-salon' },
    {
      id: TAX_SALON_ID,
      name: 'Tax Salon',
      slug: 'checkout-tax-salon',
      settings: {
        payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } },
      },
    },
  ]);
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Integration Tech',
  });
  await db.insert(schema.serviceSchema).values([
    {
      id: 'svc_checkout_biab',
      salonId: SALON_ID,
      name: 'BIAB Short',
      category: 'builder_gel',
      price: 4500,
      durationMinutes: 60,
    },
    {
      id: 'svc_checkout_french',
      salonId: SALON_ID,
      name: 'French Tips',
      category: 'manicure',
      price: 6000,
      durationMinutes: 75,
    },
  ]);
  await db.insert(schema.addOnSchema).values({
    id: 'addon_checkout_chrome',
    salonId: SALON_ID,
    slug: 'chrome-finish',
    name: 'Chrome Finish',
    category: 'nail_art',
    priceCents: 1500,
    durationMinutes: 15,
  });
}, 60_000);

beforeEach(() => {
  evaluateAndFlagIfNeeded.mockClear();
  holder.access = { actorRole: 'admin', salonId: SALON_ID };
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /complete — checkout integration', () => {
  it('legacy empty-ish body completes exactly as before this phase', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({ paymentStatus: 'paid' }), { params: { id } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.appointment.paymentStatus).toBe('paid');

    const appointment = await loadAppointment(id);

    expect(appointment.status).toBe('completed');
    expect(appointment.paymentStatus).toBe('paid');
    expect(appointment.finalPriceCents).toBe(4500);
    expect(appointment.tipCents).toBe(0);
    expect(appointment.taxEnabledSnapshot).toBe(false);
    expect(appointment.taxAmountCents).toBeNull();
    expect(appointment.amountPaidCents).toBeNull();

    const finalItems = await db.select().from(schema.appointmentFinalItemSchema)
      .where(eq(schema.appointmentFinalItemSchema.appointmentId, id));
    const payments = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));

    expect(finalItems).toHaveLength(0);
    expect(payments).toHaveLength(0);
  });

  it('full checkout payload writes items, tax snapshot, payments, and times atomically — booked junctions untouched', async () => {
    holder.access = { actorRole: 'admin', salonId: SALON_ID };
    const id = await seedAppointment({ salonId: TAX_SALON_ID });
    // Photo skipped explicitly (soft gate)

    const response = await completePatch(patchRequest({
      skipPhotoValidation: true,
      finalItems: [
        { kind: 'service', catalogServiceId: 'svc_checkout_biab', name: 'BIAB Short', quantity: 1, unitPriceCents: 4500 },
        { kind: 'addon', catalogAddOnId: 'addon_checkout_chrome', name: 'Chrome Finish', quantity: 1, unitPriceCents: 1500 },
        { kind: 'custom', name: 'Nail repair', quantity: 2, unitPriceCents: 500 },
      ],
      discountCents: 1000,
      discountReason: 'Loyal client',
      tipCents: 1000,
      actualStartAt: '2026-07-18T14:05:00Z',
      actualEndAt: '2026-07-18T15:10:00Z',
      payments: [{ amountCents: 3000, method: 'e_transfer', reference: 'ETR-1' }],
    }), { params: { id } });
    const body = await response.json();

    expect(response.status).toBe(200);

    // subtotal 7000, discount 1000 → taxable 6000, HST 13% exclusive = 780
    expect(body.data.totals).toMatchObject({
      finalSubtotalCents: 7000,
      finalDiscountCents: 1000,
      taxableSubtotalCents: 6000,
      taxAmountCents: 780,
      finalPriceCents: 6000,
      tipCents: 1000,
      totalDueCents: 7780,
    });
    expect(body.data.appointment.paymentStatus).toBe('partially_paid');

    const appointment = await loadAppointment(id);

    expect(appointment.finalPriceCents).toBe(6000);
    expect(appointment.taxNameSnapshot).toBe('HST');
    expect(appointment.taxRateBps).toBe(1300);
    expect(appointment.taxInclusive).toBe(false);
    expect(appointment.taxAmountCents).toBe(780);
    expect(appointment.amountPaidCents).toBe(3000);
    expect(appointment.actualStartAt?.toISOString()).toBe('2026-07-18T14:05:00.000Z');
    expect(appointment.actualEndAt?.toISOString()).toBe('2026-07-18T15:10:00.000Z');

    const finalItems = await db.select().from(schema.appointmentFinalItemSchema)
      .where(eq(schema.appointmentFinalItemSchema.appointmentId, id));

    expect(finalItems).toHaveLength(3);
    expect(finalItems.find(item => item.kind === 'custom')).toMatchObject({
      name: 'Nail repair',
      quantity: 2,
      lineTotalCents: 1000,
    });

    // The booked snapshot is immutable — the original junction row survives.
    const bookedRows = await db.select().from(schema.appointmentServicesSchema)
      .where(eq(schema.appointmentServicesSchema.appointmentId, id));

    expect(bookedRows).toHaveLength(1);
    expect(bookedRows[0]!.nameSnapshot).toBe('BIAB Short');

    // Unpaid-balance completion never triggers fraud/points.
    expect(evaluateAndFlagIfNeeded).not.toHaveBeenCalled();

    const auditActions = (await db.select().from(schema.appointmentAuditLogSchema)
      .where(eq(schema.appointmentAuditLogSchema.appointmentId, id)))
      .map(row => row.action)
      .sort();

    expect(auditActions).toEqual([
      'completed',
      'discount_applied',
      'items_changed',
      'payment_recorded',
      'times_recorded',
    ]);
  });

  it('idempotent replay inserts nothing', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    const first = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      payments: [{ amountCents: 5000, method: 'cash' }],
    }), { params: { id } });

    expect(first.status).toBe(200);

    const replay = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      payments: [{ amountCents: 5000, method: 'cash' }],
    }), { params: { id } });

    expect(replay.status).toBe(200);

    const payments = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));
    const finalItems = await db.select().from(schema.appointmentFinalItemSchema)
      .where(eq(schema.appointmentFinalItemSchema.appointmentId, id));

    expect(payments).toHaveLength(1);
    expect(finalItems).toHaveLength(1);
  });

  it('fully-paid checkout completion triggers fraud/points exactly once', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    // salonClientId is self-healed via getOrCreateSalonClient (real query).
    const response = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 4000 }],
      payments: [{ amountCents: 4000, method: 'cash' }],
    }), { params: { id } });

    expect(response.status).toBe(200);
    expect((await response.json()).data.appointment.paymentStatus).toBe('paid');
    expect(evaluateAndFlagIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('legacy performedServiceIds record final items without destroying junctions, money follows the entered price', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({
      performedServiceIds: ['svc_checkout_french'],
      performedAddOnIds: ['addon_checkout_chrome'],
      finalPriceCents: 8000, // staff-entered price wins over catalog sum (7500)
      tipCents: 500,
      paymentMethod: 'cash',
      skipPhotoValidation: true,
    }), { params: { id } });

    expect(response.status).toBe(200);

    const appointment = await loadAppointment(id);

    expect(appointment.finalPriceCents).toBe(8000);
    expect(appointment.tipCents).toBe(500);
    expect(appointment.paymentStatus).toBe('paid'); // legacy contract

    const finalItems = await db.select().from(schema.appointmentFinalItemSchema)
      .where(eq(schema.appointmentFinalItemSchema.appointmentId, id));

    expect(finalItems.map(item => item.name).sort()).toEqual(['Chrome Finish', 'French Tips']);

    const bookedRows = await db.select().from(schema.appointmentServicesSchema)
      .where(eq(schema.appointmentServicesSchema.appointmentId, id));

    expect(bookedRows).toHaveLength(1); // never deleted
  });

  it('legacy-shape completion on a tax-enabled salon still snapshots tax', async () => {
    const id = await seedAppointment({ salonId: TAX_SALON_ID, totalPrice: 10000 });

    const response = await completePatch(patchRequest({ skipPhotoValidation: true }), { params: { id } });

    expect(response.status).toBe(200);

    const appointment = await loadAppointment(id);

    // Exclusive 13% on the default-taxable booked total.
    expect(appointment.taxEnabledSnapshot).toBe(true);
    expect(appointment.taxNameSnapshot).toBe('HST');
    expect(appointment.taxAmountCents).toBe(1300);
    expect(appointment.finalPriceCents).toBe(10000);
  });

  it('rejects payments exceeding the total due at completion', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 1000 }],
      payments: [{ amountCents: 5000, method: 'cash' }],
    }), { params: { id } });

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('PAYMENTS_EXCEED_TOTAL');
    expect((await loadAppointment(id)).status).toBe('confirmed');
  });

  it('409s with the server breakdown when expected totals drift', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      expectedTotalDueCents: 4200,
    }), { params: { id } });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('TOTALS_MISMATCH');
    expect(body.error.details.totals.totalDueCents).toBe(5000);
  });

  it('admin comp completion counts zero balance and skips fraud', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      paymentStatusIntent: 'comp',
      payments: [],
    }), { params: { id } });

    expect(response.status).toBe(200);

    const appointment = await loadAppointment(id);

    expect(appointment.paymentStatus).toBe('comp');
    expect(appointment.amountPaidCents).toBe(0);
    expect(evaluateAndFlagIfNeeded).not.toHaveBeenCalled();
  });
});

describe('POST /payments + void + reopen — integration', () => {
  async function completeWithBalance() {
    const id = await seedAppointment();
    await addAfterPhoto(id);
    const response = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 10000 }],
      tipCents: 1000,
      payments: [{ amountCents: 4000, method: 'e_transfer', reference: 'ETR-9' }],
    }), { params: { id } });

    expect(response.status).toBe(200);

    return id; // totalDue 11000, paid 4000, balance 7000
  }

  function paymentRequest(body: unknown) {
    return new Request('http://localhost/api/appointments/x/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('records partial then final payments; fraud fires once on the paid transition', async () => {
    const id = await completeWithBalance();

    const partial = await recordPayment(paymentRequest({ amountCents: 3000, method: 'cash' }), { params: { id } });
    const partialBody = await partial.json();

    expect(partial.status).toBe(200);
    expect(partialBody.data.paymentStatus).toBe('partially_paid');
    expect(partialBody.data.amountPaidCents).toBe(7000);
    expect(partialBody.data.balanceCents).toBe(4000);
    expect(evaluateAndFlagIfNeeded).not.toHaveBeenCalled();

    const final = await recordPayment(paymentRequest({ amountCents: 4000, method: 'cash' }), { params: { id } });
    const finalBody = await final.json();

    expect(final.status).toBe(200);
    expect(finalBody.data.paymentStatus).toBe('paid');
    expect(finalBody.data.balanceCents).toBe(0);
    expect(evaluateAndFlagIfNeeded).toHaveBeenCalledTimes(1);

    expect((await loadAppointment(id)).amountPaidCents).toBe(11000);
  });

  it('rejects a payment exceeding the remaining balance', async () => {
    const id = await completeWithBalance();

    const response = await recordPayment(paymentRequest({ amountCents: 8000 }), { params: { id } });

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('PAYMENT_EXCEEDS_BALANCE');
  });

  it('rejects payments on non-completed appointments', async () => {
    const id = await seedAppointment();

    const response = await recordPayment(paymentRequest({ amountCents: 1000 }), { params: { id } });

    expect(response.status).toBe(409);
  });

  it('staff cannot void; admin void recomputes from source', async () => {
    const id = await completeWithBalance();
    const [payment] = await db.select().from(schema.appointmentPaymentSchema)
      .where(and(
        eq(schema.appointmentPaymentSchema.appointmentId, id),
        isNull(schema.appointmentPaymentSchema.voidedAt),
      ));

    holder.access = { actorRole: 'staff', salonId: SALON_ID, technicianId: TECH_ID };
    const staffAttempt = await voidPayment(
      new Request('http://localhost/void', { method: 'POST' }),
      { params: { id, paymentId: payment!.id } },
    );

    expect(staffAttempt.status).toBe(403);

    holder.access = { actorRole: 'admin', salonId: SALON_ID };
    const adminVoid = await voidPayment(
      new Request('http://localhost/void', { method: 'POST' }),
      { params: { id, paymentId: payment!.id } },
    );
    const voidBody = await adminVoid.json();

    expect(adminVoid.status).toBe(200);
    expect(voidBody.data.amountPaidCents).toBe(0);
    expect(voidBody.data.paymentStatus).toBe('pending');
    expect((await loadAppointment(id)).amountPaidCents).toBe(0);
  });

  it('reopen is admin-only, reverts to in_progress, keeps payments; re-completion replaces final items', async () => {
    const id = await completeWithBalance();

    holder.access = { actorRole: 'staff', salonId: SALON_ID, technicianId: TECH_ID };
    const staffAttempt = await reopenAppointment(
      new Request('http://localhost/reopen', { method: 'POST' }),
      { params: { id } },
    );

    expect(staffAttempt.status).toBe(403);

    holder.access = { actorRole: 'admin', salonId: SALON_ID };
    const reopened = await reopenAppointment(
      new Request('http://localhost/reopen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Wrong price' }) }),
      { params: { id } },
    );

    expect(reopened.status).toBe(200);

    const midway = await loadAppointment(id);

    expect(midway.status).toBe('in_progress');
    expect(midway.completedAt).toBeNull();

    // Payments survive the reopen.
    const paymentsAfterReopen = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));

    expect(paymentsAfterReopen).toHaveLength(1);

    // Double reopen is a clean 409.
    const again = await reopenAppointment(
      new Request('http://localhost/reopen', { method: 'POST' }),
      { params: { id } },
    );

    expect(again.status).toBe(409);

    // Re-complete with different items: final items replaced wholesale, and
    // the surviving payment counts against the new totals.
    const recompleted = await completePatch(patchRequest({
      skipPhotoValidation: true,
      finalItems: [{ kind: 'custom', name: 'Corrected set', quantity: 1, unitPriceCents: 4000 }],
      payments: [],
    }), { params: { id } });

    expect(recompleted.status).toBe(200);

    const finalItems = await db.select().from(schema.appointmentFinalItemSchema)
      .where(eq(schema.appointmentFinalItemSchema.appointmentId, id));

    expect(finalItems).toHaveLength(1);
    expect(finalItems[0]!.name).toBe('Corrected set');

    // Recorded payment (4000) covers the new 4000 due → a fresh payment
    // recording of the outstanding 0 is unnecessary; balance derives to 0.
    const after = await loadAppointment(id);

    // The re-completion sent payments: [] so amountPaid resets to the derived
    // sum of checkout-recorded rows (0 new), while historical rows remain.
    expect(after.status).toBe('completed');
  });
});
