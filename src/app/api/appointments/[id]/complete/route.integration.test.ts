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

import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
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

async function addPaidDeposit(
  appointmentId: string,
  overrides: Partial<typeof schema.appointmentDepositSchema.$inferInsert> = {},
) {
  await db.insert(schema.appointmentDepositSchema).values({
    id: `dep_${appointmentId}`,
    salonId: SALON_ID,
    appointmentId,
    amountCents: 2500,
    currency: 'cad',
    status: 'paid',
    stripeAccountId: 'acct_checkout_test',
    stripePaymentIntentId: `pi_${appointmentId}`,
    ...overrides,
  });
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

beforeEach(async () => {
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  evaluateAndFlagIfNeeded.mockClear();
  holder.access = { actorRole: 'admin', salonId: SALON_ID };
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /complete — checkout integration', () => {
  it('applies deposit plus tender exactly once with tip separately due', async () => {
    const id = await seedAppointment({ invoiceCurrency: 'CAD' });
    await addPaidDeposit(id);
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 10000 }],
      tipCents: 1000,
      payments: [{ amountCents: 8500, method: 'cash' }],
    }), { params: { id } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.totals).toMatchObject({
      totalDueCents: 11000,
      appointmentPaymentsCents: 8500,
      depositCreditAppliedCents: 2500,
      amountAlreadyPaidCents: 11000,
      balanceCents: 0,
    });
    expect(body.data.depositCredit).toMatchObject({
      state: 'resolved',
      collectedCents: 2500,
      refundedCents: 0,
      forfeitedCents: 0,
      eligibleCents: 2500,
    });

    const appointment = await loadAppointment(id);
    const payments = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));

    expect(appointment).toMatchObject({
      invoiceCurrency: 'CAD',
      amountPaidCents: 8500,
      paymentStatus: 'paid',
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.amountCents).toBe(8500);
    expect(evaluateAndFlagIfNeeded).not.toHaveBeenCalled();
  });

  it('preserves a non-null booked currency instead of overwriting it from mutable settings', async () => {
    const id = await seedAppointment({ invoiceCurrency: 'USD' });
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      payments: [],
    }), { params: { id } });

    expect(response.status).toBe(200);
    expect((await loadAppointment(id)).invoiceCurrency).toBe('USD');
  });

  it('blocks live completion with DEPOSIT_EXCESS_REQUIRES_REFUND when the deposit exceeds the invoice', async () => {
    const id = await seedAppointment({ invoiceCurrency: 'CAD' });
    await addPaidDeposit(id); // $25.00 paid deposit
    await addAfterPhoto(id);

    // Final invoice ($10.00, tax disabled) is below the eligible credit, and
    // no permitted partial-refund path exists: OD6-P6 requires a typed block,
    // never a silently retained excess or a settled completion.
    const response = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Trim', quantity: 1, unitPriceCents: 1000 }],
      payments: [],
    }), { params: { id } });

    expect(response.status).toBe(409);

    const body = await response.json();

    expect(body.error.code).toBe('DEPOSIT_EXCESS_REQUIRES_REFUND');
    expect(body.error.details).toEqual({ excessDepositCents: 1500 });

    // The blocked completion must leave no financial state behind.
    const row = await loadAppointment(id);

    expect(row.status).toBe('confirmed');
    expect(row.completedAt).toBeNull();
    expect(row.finalTaxSnapshot).toBeNull();

    const payments = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));
    const finalItems = await db.select().from(schema.appointmentFinalItemSchema)
      .where(eq(schema.appointmentFinalItemSchema.appointmentId, id));

    expect(payments).toHaveLength(0);
    expect(finalItems).toHaveLength(0);
  });

  it('fails closed instead of guessing currency for a historical deposit appointment', async () => {
    const id = await seedAppointment({ invoiceCurrency: null });
    await addPaidDeposit(id);
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      payments: [],
    }), { params: { id } });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('DEPOSIT_CURRENCY_MISMATCH');
    expect((await loadAppointment(id)).status).toBe('confirmed');
  });

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
    expect(appointment.taxAmountCents).toBe(0);
    expect(appointment.finalTaxSnapshot).toMatchObject({
      kind: 'final_actual',
      classification: 'actual',
      taxApplied: false,
      taxAmountCents: 0,
      invoiceTotalCents: 4500,
    });
    expect(appointment.amountPaidCents).toBeNull();

    const finalItems = await db.select().from(schema.appointmentFinalItemSchema)
      .where(eq(schema.appointmentFinalItemSchema.appointmentId, id));
    const payments = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));

    expect(finalItems).toHaveLength(0);
    expect(payments).toHaveLength(0);
  });

  it.each(['waived', 'expired', 'canceled'] as const)(
    'preserves legacy paid inference for clean %s deposit history without inventing deposit credit',
    async (status) => {
      const id = await seedAppointment({ invoiceCurrency: 'CAD' });
      await addPaidDeposit(id, {
        status,
        stripePaymentIntentId: null,
      });
      await addAfterPhoto(id);

      const response = await completePatch(patchRequest({}), { params: { id } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.appointment.paymentStatus).toBe('paid');
      expect(body.data.depositCredit).toMatchObject({
        state: 'resolved',
        collectedCents: 0,
        refundedCents: 0,
        forfeitedCents: 0,
        eligibleCents: 0,
      });
      expect(body.data.totals).toMatchObject({
        totalDueCents: 4500,
        appointmentPaymentsCents: 4500,
        depositCreditAppliedCents: 0,
        amountAlreadyPaidCents: 4500,
        balanceCents: 0,
      });

      const stored = await loadAppointment(id);
      const payments = await db.select().from(schema.appointmentPaymentSchema)
        .where(eq(schema.appointmentPaymentSchema.appointmentId, id));

      expect(stored).toMatchObject({
        status: 'completed',
        paymentStatus: 'paid',
        amountPaidCents: null,
      });
      expect(payments).toHaveLength(0);

      const replay = await completePatch(patchRequest({}), { params: { id } });
      const replayBody = await replay.json();

      expect(replay.status).toBe(200);
      expect(replayBody.data.appointment.paymentStatus).toBe('paid');
      expect(replayBody.data.totals).toMatchObject({
        appointmentPaymentsCents: 4500,
        depositCreditAppliedCents: 0,
        amountAlreadyPaidCents: 4500,
        balanceCents: 0,
      });
    },
  );

  it('does not let legacy completion imply that an unpaid post-deposit balance was collected', async () => {
    const id = await seedAppointment({ invoiceCurrency: 'CAD' });
    await addPaidDeposit(id);
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({}), { params: { id } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.appointment.paymentStatus).toBe('partially_paid');
    expect(body.data.totals).toMatchObject({
      totalDueCents: 4500,
      appointmentPaymentsCents: 0,
      depositCreditAppliedCents: 2500,
      amountAlreadyPaidCents: 2500,
      balanceCents: 2000,
    });

    const stored = await loadAppointment(id);

    expect(stored.paymentStatus).toBe('partially_paid');
    expect(stored.amountPaidCents).toBe(0);

    const replay = await completePatch(patchRequest({}), { params: { id } });
    const replayBody = await replay.json();

    expect(replay.status).toBe(200);
    expect(replayBody.data.appointment.paymentStatus).toBe('partially_paid');
    expect(replayBody.data.totals).toMatchObject({
      appointmentPaymentsCents: 0,
      depositCreditAppliedCents: 2500,
      amountAlreadyPaidCents: 2500,
      balanceCents: 2000,
    });
  });

  it('blocks fresh completion and completion replay when a positive paid cache has no ledger rows', async () => {
    const freshId = await seedAppointment({
      invoiceCurrency: 'CAD',
      amountPaidCents: 2500,
    });
    await addAfterPhoto(freshId);

    const freshResponse = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 4500 }],
      payments: [{ amountCents: 2000, method: 'cash' }],
    }), { params: { id: freshId } });

    expect(freshResponse.status).toBe(409);
    await expect(freshResponse.json()).resolves.toMatchObject({
      error: { code: 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED' },
    });
    expect((await loadAppointment(freshId)).status).toBe('confirmed');

    const replayId = await seedAppointment({
      status: 'completed',
      completedAt: new Date('2026-08-01T15:00:00Z'),
      invoiceCurrency: 'CAD',
      finalPriceCents: 4500,
      taxAmountCents: 0,
      amountPaidCents: 2500,
      paymentStatus: 'partially_paid',
    });
    const replayResponse = await completePatch(patchRequest({}), { params: { id: replayId } });

    expect(replayResponse.status).toBe(409);
    await expect(replayResponse.json()).resolves.toMatchObject({
      error: { code: 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED' },
    });
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
    expect(appointment.finalTaxSnapshot).toMatchObject({
      kind: 'final_actual',
      classification: 'actual',
      currency: 'CAD',
      taxableSubtotalCents: 6000,
      taxAmountCents: 780,
      invoiceTotalCents: 6780,
    });
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

    const firstBody = await first.json();

    const replay = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      payments: [{ amountCents: 5000, method: 'cash' }],
    }), { params: { id } });

    expect(replay.status).toBe(200);

    const replayBody = await replay.json();

    expect(replayBody.data.totals).toEqual(firstBody.data.totals);
    expect(replayBody.data.depositCredit).toEqual(firstBody.data.depositCredit);

    const payments = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));
    const finalItems = await db.select().from(schema.appointmentFinalItemSchema)
      .where(eq(schema.appointmentFinalItemSchema.appointmentId, id));

    expect(payments).toHaveLength(1);
    expect(finalItems).toHaveLength(1);
  });

  it('normalizes an empty tax-exempt reason to null on both the scalar and the snapshot', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    const first = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      payments: [{ amountCents: 5000, method: 'cash' }],
      taxExempt: true,
      taxExemptReason: '   ',
    }), { params: { id } });

    expect(first.status).toBe(200);

    const row = await loadAppointment(id);
    const finalSnapshot = row.finalTaxSnapshot as { taxExemptReason: string | null } | null;

    expect(row.taxExempt).toBe(true);
    expect(row.taxExemptReason).toBeNull();
    expect(finalSnapshot?.taxExemptReason).toBeNull();

    // Replay revalidates the entire frozen chain: a stored '' beside a
    // snapshot null would 409 with TAX_SNAPSHOT_ARITHMETIC_MISMATCH here.
    const replay = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      payments: [{ amountCents: 5000, method: 'cash' }],
      taxExempt: true,
      taxExemptReason: '',
    }), { params: { id } });

    expect(replay.status).toBe(200);
  });

  it('stores one identical normalized tax-exempt reason on the scalar and the snapshot', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    const first = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      payments: [{ amountCents: 5000, method: 'cash' }],
      taxExempt: true,
      taxExemptReason: '  Charity event  ',
    }), { params: { id } });

    expect(first.status).toBe(200);

    const row = await loadAppointment(id);
    const finalSnapshot = row.finalTaxSnapshot as { taxExemptReason: string | null } | null;

    expect(row.taxExemptReason).toBe('Charity event');
    expect(finalSnapshot?.taxExemptReason).toBe('Charity event');

    const replay = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 5000 }],
      payments: [{ amountCents: 5000, method: 'cash' }],
      taxExempt: true,
      taxExemptReason: 'Charity event',
    }), { params: { id } });

    expect(replay.status).toBe(200);
  });

  it('blocks completed replay when D6.1 booking evidence survives final-snapshot deletion', async () => {
    const bookingTaxSnapshot = buildBookingTaxSnapshot({
      taxConfig: DISABLED_TAX_CONFIG,
      totals: {
        taxApplied: false,
        taxableSubtotalCents: 0,
        taxAmountCents: 0,
        finalPriceCents: 4500,
      },
      capturedAt: new Date('2026-07-01T12:00:00.000Z'),
      currency: 'CAD',
    });
    const id = await seedAppointment({
      status: 'completed',
      completedAt: new Date('2026-07-01T15:00:00.000Z'),
      paymentStatus: 'paid',
      invoiceCurrency: 'CAD',
      bookingTaxSnapshot,
      finalTaxSnapshot: null,
      finalPriceCents: 4500,
      taxableSubtotalCents: 0,
      taxAmountCents: 0,
    });

    const response = await completePatch(patchRequest({}), { params: { id } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'TAX_SNAPSHOT_INVALID',
        details: { reason: 'TAX_SNAPSHOT_INVALID_SHAPE' },
      },
    });
  });

  it('blocks completed replay while a deposit refund is unresolved', async () => {
    const id = await seedAppointment({
      status: 'completed',
      completedAt: new Date('2026-07-01T15:00:00.000Z'),
      paymentStatus: 'partially_paid',
      invoiceCurrency: 'CAD',
      finalPriceCents: 4500,
      taxableSubtotalCents: 0,
      taxAmountCents: 0,
      amountPaidCents: 0,
    });
    await addPaidDeposit(id, {
      refundStatus: 'pending',
      refundStatusChangedAt: new Date('2026-07-01T16:00:00.000Z'),
    });

    const response = await completePatch(patchRequest({}), { params: { id } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'DEPOSIT_REFUND_IN_FLIGHT' },
    });
  });

  it('blocks completed replay when a late deposit creates tender excess', async () => {
    const id = await seedAppointment({
      status: 'completed',
      completedAt: new Date('2026-07-01T15:00:00.000Z'),
      paymentStatus: 'pending',
      invoiceCurrency: 'CAD',
      finalPriceCents: 4500,
      taxableSubtotalCents: 0,
      taxAmountCents: 0,
      amountPaidCents: 4500,
    });
    await db.insert(schema.appointmentPaymentSchema).values({
      id: `pay_${id}_full`,
      appointmentId: id,
      salonId: SALON_ID,
      amountCents: 4500,
      recordedByType: 'staff',
      recordedById: TECH_ID,
    });
    await addPaidDeposit(id);

    const response = await completePatch(patchRequest({}), { params: { id } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED',
      },
    });
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

  it('recomputes expected totals from the salon configuration locked at invoice issue', async () => {
    const id = await seedAppointment({ salonId: TAX_SALON_ID, totalPrice: 10000 });

    const response = await completePatch(patchRequest({
      skipPhotoValidation: true,
      expectedTotalDueCents: 10000,
    }), { params: { id } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'TOTALS_MISMATCH',
        details: { totals: { totalDueCents: 11300, taxAmountCents: 1300 } },
      },
    });
    expect((await loadAppointment(id)).status).toBe('confirmed');
  });

  it('rejects checkout arithmetic outside the supported minor-unit range', async () => {
    const id = await seedAppointment();
    await addAfterPhoto(id);

    const response = await completePatch(patchRequest({
      finalItems: [{
        kind: 'custom',
        name: 'Out-of-range set',
        quantity: 99,
        unitPriceCents: 1_000_000,
      }],
    }), { params: { id } });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CHECKOUT_MONEY_OUT_OF_RANGE' },
    });
    expect((await loadAppointment(id)).status).toBe('confirmed');
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
    const payload = body && typeof body === 'object' && !Array.isArray(body)
      ? { idempotencyKey: `test-payment-${crypto.randomUUID()}`, ...body }
      : body;
    return new Request('http://localhost/api/appointments/x/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

  it('does not attribute a deposit-funded paid transition to fraud', async () => {
    const id = await seedAppointment({ invoiceCurrency: 'CAD' });

    await addPaidDeposit(id);
    await addAfterPhoto(id);

    const completed = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 10000 }],
    }), { params: { id } });

    expect(completed.status).toBe(200);
    expect((await completed.json()).data.appointment.paymentStatus).toBe('partially_paid');
    expect(evaluateAndFlagIfNeeded).not.toHaveBeenCalled();

    const settled = await recordPayment(paymentRequest({
      amountCents: 7500,
      method: 'cash',
    }), { params: { id } });

    expect(settled.status).toBe(200);
    expect((await settled.json()).data.paymentStatus).toBe('paid');
    expect(evaluateAndFlagIfNeeded).not.toHaveBeenCalled();
  });

  it('deduplicates a keyed payment retry and rejects key reuse with different money', async () => {
    const id = await completeWithBalance();
    const request = {
      amountCents: 3000,
      method: 'cash',
      idempotencyKey: 'checkout-retry-key-1',
    } as const;

    const first = await recordPayment(paymentRequest(request), { params: { id } });
    const replay = await recordPayment(paymentRequest(request), { params: { id } });
    const conflict = await recordPayment(paymentRequest({
      ...request,
      amountCents: 3001,
    }), { params: { id } });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.idempotentReplay).toBe(true);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const payments = await db.select().from(schema.appointmentPaymentSchema)
      .where(and(
        eq(schema.appointmentPaymentSchema.appointmentId, id),
        isNull(schema.appointmentPaymentSchema.voidedAt),
      ));

    expect(payments).toHaveLength(2);
    expect(payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(7000);
    expect((await loadAppointment(id)).amountPaidCents).toBe(7000);
  });

  it('replays the original keyed response before mutable refund-state validation', async () => {
    const id = await seedAppointment({ invoiceCurrency: 'CAD' });
    await addPaidDeposit(id);
    await addAfterPhoto(id);
    const completed = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 10000 }],
      payments: [{ amountCents: 4000, method: 'cash' }],
    }), { params: { id } });

    expect(completed.status).toBe(200);

    const request = {
      amountCents: 1000,
      method: 'cash',
      idempotencyKey: 'refund-drift-retry-key',
    } as const;
    const first = await recordPayment(paymentRequest(request), { params: { id } });
    const firstBody = await first.json();

    expect(first.status).toBe(200);

    await db.update(schema.appointmentDepositSchema).set({
      refundStatus: 'pending',
      refundStatusChangedAt: new Date('2026-08-15T12:00:00.000Z'),
    }).where(eq(schema.appointmentDepositSchema.appointmentId, id));
    const completedAppointment = await loadAppointment(id);
    const bookingTaxSnapshot = buildBookingTaxSnapshot({
      taxConfig: DISABLED_TAX_CONFIG,
      totals: {
        taxApplied: false,
        taxableSubtotalCents: 0,
        taxAmountCents: 0,
        finalPriceCents: completedAppointment.totalPrice,
      },
      capturedAt: new Date('2026-07-01T12:00:00.000Z'),
      currency: 'CAD',
    });
    await db.update(schema.appointmentSchema).set({
      // The durable retry must also precede current snapshot validation. This
      // simulates scalar drift plus deletion of required final evidence after
      // the original payment commit.
      bookingTaxSnapshot,
      finalTaxSnapshot: null,
      taxableSubtotalCents: (completedAppointment.taxableSubtotalCents ?? 0) + 1,
    }).where(eq(schema.appointmentSchema.id, id));

    const replay = await recordPayment(paymentRequest(request), { params: { id } });
    const replayBody = await replay.json();

    expect(replay.status).toBe(200);
    expect(replayBody.data).toEqual({
      ...firstBody.data,
      idempotentReplay: true,
    });

    const keyedRows = (await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id)))
      .filter(row => row.idempotencyKey === request.idempotencyKey);

    expect(keyedRows).toHaveLength(1);
  });

  it('blocks new payment and void mutations when final snapshot scalars drift', async () => {
    const id = await completeWithBalance();
    const before = await loadAppointment(id);

    expect(before.finalTaxSnapshot).not.toBeNull();

    const [existingPayment] = await db.select().from(schema.appointmentPaymentSchema)
      .where(and(
        eq(schema.appointmentPaymentSchema.appointmentId, id),
        isNull(schema.appointmentPaymentSchema.voidedAt),
      ));

    expect(existingPayment).toBeDefined();

    await db.update(schema.appointmentSchema).set({
      taxableSubtotalCents: (before.taxableSubtotalCents ?? 0) + 1,
    }).where(eq(schema.appointmentSchema.id, id));

    const paymentResponse = await recordPayment(
      paymentRequest({ amountCents: 1000, method: 'cash' }),
      { params: { id } },
    );

    expect(paymentResponse.status).toBe(409);
    await expect(paymentResponse.json()).resolves.toMatchObject({
      error: {
        code: 'TAX_SNAPSHOT_INVALID',
        details: { reason: 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH' },
      },
    });

    const voidResponse = await voidPayment(
      new Request('http://localhost/void', { method: 'POST' }),
      { params: { id, paymentId: existingPayment!.id } },
    );

    expect(voidResponse.status).toBe(409);
    await expect(voidResponse.json()).resolves.toMatchObject({
      error: {
        code: 'TAX_SNAPSHOT_INVALID',
        details: { reason: 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH' },
      },
    });

    const [unchangedPayment] = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.id, existingPayment!.id));
    const allPayments = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));

    expect(unchangedPayment!.voidedAt).toBeNull();
    expect(allPayments).toHaveLength(1);
    expect((await loadAppointment(id)).amountPaidCents).toBe(before.amountPaidCents);
  });

  it('blocks payment and void when booking evidence survives final-snapshot deletion', async () => {
    const bookingTaxSnapshot = buildBookingTaxSnapshot({
      taxConfig: DISABLED_TAX_CONFIG,
      totals: {
        taxApplied: false,
        taxableSubtotalCents: 0,
        taxAmountCents: 0,
        finalPriceCents: 4500,
      },
      capturedAt: new Date('2026-07-01T12:00:00.000Z'),
      currency: 'CAD',
    });
    const id = await seedAppointment({
      status: 'completed',
      completedAt: new Date('2026-07-01T15:00:00.000Z'),
      invoiceCurrency: 'CAD',
      bookingTaxSnapshot,
      finalTaxSnapshot: null,
      finalPriceCents: 10000,
      taxableSubtotalCents: 0,
      taxAmountCents: 0,
      taxExempt: false,
      taxExemptReason: null,
      tipCents: 1000,
      amountPaidCents: 4000,
      paymentStatus: 'partially_paid',
    });
    const paymentId = `pay_${id}`;
    const replayKey = 'deleted-final-snapshot-replay-key';
    await db.insert(schema.appointmentPaymentSchema).values({
      id: paymentId,
      appointmentId: id,
      salonId: SALON_ID,
      amountCents: 4000,
      method: 'cash',
      idempotencyKey: replayKey,
      recordedByType: 'admin',
      recordedById: 'admin_checkout',
      recordedAt: new Date('2026-07-01T15:00:00.000Z'),
    });
    await db.insert(schema.appointmentAuditLogSchema).values({
      id: `audit_${id}`,
      appointmentId: id,
      salonId: SALON_ID,
      action: 'payment_recorded',
      performedBy: 'admin_checkout',
      performedByRole: 'admin',
      newValue: {
        paymentId,
        idempotencyKey: replayKey,
        paymentStatus: 'partially_paid',
        amountPaidCents: 4000,
        depositCreditAppliedCents: 0,
        amountAlreadyPaidCents: 4000,
        totalDueCents: 11000,
        balanceCents: 7000,
      },
    });

    const replayResponse = await recordPayment(
      paymentRequest({ amountCents: 4000, method: 'cash', idempotencyKey: replayKey }),
      { params: { id } },
    );

    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toMatchObject({
      data: {
        idempotentReplay: true,
        amountPaidCents: 4000,
        balanceCents: 7000,
      },
    });

    const paymentResponse = await recordPayment(
      paymentRequest({ amountCents: 1000, method: 'cash' }),
      { params: { id } },
    );

    expect(paymentResponse.status).toBe(409);
    await expect(paymentResponse.json()).resolves.toMatchObject({
      error: {
        code: 'TAX_SNAPSHOT_INVALID',
        details: { reason: 'TAX_SNAPSHOT_INVALID_SHAPE' },
      },
    });

    const voidResponse = await voidPayment(
      new Request('http://localhost/void', { method: 'POST' }),
      { params: { id, paymentId } },
    );

    expect(voidResponse.status).toBe(409);
    await expect(voidResponse.json()).resolves.toMatchObject({
      error: {
        code: 'TAX_SNAPSHOT_INVALID',
        details: { reason: 'TAX_SNAPSHOT_INVALID_SHAPE' },
      },
    });

    const payments = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));

    expect(payments).toHaveLength(1);
    expect(payments[0]!.voidedAt).toBeNull();
    expect((await loadAppointment(id)).amountPaidCents).toBe(4000);
  });

  it('requires a durable payment retry identity', async () => {
    const id = await completeWithBalance();
    const response = await recordPayment(new Request(
      'http://localhost/api/appointments/x/payments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: 1000, method: 'cash' }),
      },
    ), { params: { id } });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('does not void tender while the credited deposit refund is unresolved', async () => {
    const id = await seedAppointment({ invoiceCurrency: 'CAD' });
    await addPaidDeposit(id);
    await addAfterPhoto(id);
    const completed = await completePatch(patchRequest({
      finalItems: [{ kind: 'custom', name: 'Set', quantity: 1, unitPriceCents: 10000 }],
      payments: [{ amountCents: 4000, method: 'cash' }],
    }), { params: { id } });

    expect(completed.status).toBe(200);

    await db.update(schema.appointmentDepositSchema).set({
      refundStatus: 'pending',
      refundStatusChangedAt: new Date('2026-08-15T12:00:00.000Z'),
    }).where(eq(schema.appointmentDepositSchema.appointmentId, id));
    const [payment] = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));

    const response = await voidPayment(
      new Request('http://localhost/void', { method: 'POST' }),
      { params: { id, paymentId: payment!.id } },
    );
    const [unchanged] = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.id, payment!.id));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('DEPOSIT_REFUND_IN_FLIGHT');
    expect(unchanged!.voidedAt).toBeNull();
    expect((await loadAppointment(id)).amountPaidCents).toBe(4000);
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

  it('keeps finalized D6.1 invoice evidence immutable when an admin requests reopen', async () => {
    const id = await completeWithBalance();

    holder.access = { actorRole: 'staff', salonId: SALON_ID, technicianId: TECH_ID };
    const staffAttempt = await reopenAppointment(
      new Request('http://localhost/reopen', { method: 'POST' }),
      { params: { id } },
    );

    expect(staffAttempt.status).toBe(403);

    holder.access = { actorRole: 'admin', salonId: SALON_ID };
    const reopenAttempt = await reopenAppointment(
      new Request('http://localhost/reopen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Wrong price' }) }),
      { params: { id } },
    );
    const reopenBody = await reopenAttempt.json();

    expect(reopenAttempt.status).toBe(409);
    expect(reopenBody.error.code).toBe('INVOICE_REVISION_UNSUPPORTED');

    const unchanged = await loadAppointment(id);

    expect(unchanged.status).toBe('completed');
    expect(unchanged.completedAt).not.toBeNull();
    expect(unchanged.finalTaxSnapshot).not.toBeNull();

    const paymentsAfterAttempt = await db.select().from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.appointmentId, id));

    expect(paymentsAfterAttempt).toHaveLength(1);
  });
});
