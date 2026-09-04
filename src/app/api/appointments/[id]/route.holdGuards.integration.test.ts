/**
 * D4 §5.8 — THE PATCH HOLD GUARDS, on real rows (D4-REV-2).
 *
 * Fable's exact-head review deleted the PATCH `HOLD_LOCKED` guard and the whole
 * `[id]/route.test.ts` suite stayed green. That guard is the ONLY layer in front
 * of `updateAppointmentStatus` (src/libs/queries.ts), which is a blind writer:
 * it CASes on nothing but id + salon, so whatever status the body asks for is
 * what lands. Widening a status enum widens a request body — the exact attack
 * class this guard exists for — so its removal makes an unpaid hold
 * owner-confirmable in one call.
 *
 * [P] tier: the assertion that matters is that the COMMITTED row is unchanged,
 * which a mocked writer cannot show.
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
  access: null as unknown,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentAccess: vi.fn(async () => holder.access),
}));

vi.mock('@/libs/appointmentAudit', () => ({
  logAppointmentChange: vi.fn(async () => {}),
  logAppointmentLocked: vi.fn(async () => {}),
  buildAppointmentAuditRow: vi.fn((input: Record<string, unknown>) => ({
    id: `audit_${crypto.randomUUID()}`,
    appointmentId: input.appointmentId,
    salonId: input.salonId,
    action: input.action,
    performedBy: input.performedBy,
    performedByRole: input.performedByRole,
    performedByName: input.performedByName ?? null,
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason ?? null,
  })),
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarDelete: vi.fn(async () => {}),
  enqueueGoogleCalendarUpsert: vi.fn(async () => {}),
  enqueueGoogleCalendarDeleteInTx: vi.fn(async () => ({ inserted: true })),
  enqueueGoogleCalendarAppointmentMutation: vi.fn(async () => ({ inserted: true })),
}));

vi.mock('@/libs/SMS', () => ({
  sendCancellationNotificationToTech: vi.fn(async () => ({ success: true })),
  sendCancellationConfirmation: vi.fn(async () => ({ success: true })),
  sendBookingConfirmationToClient: vi.fn(async () => ({ success: true })),
  sendRescheduleConfirmation: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForAppointmentCancelled: vi.fn(async () => {}),
}));

vi.mock('@/libs/salonNotificationEmail', () => ({
  sendSalonNotificationEmail: vi.fn(async () => ({ status: 'skipped' })),
}));

/* eslint-disable import/first */
import { PATCH } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_patch_guard';
const TECH_ID = 'tech_patch_guard';
const CLIENT_ID = 'client_patch_guard';
const APPT_ID = 'appt_patch_guard';
const DEPOSIT_ID = 'dep_patch_guard';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

const START = new Date('2099-09-01T14:00:00.000Z');
const END = new Date('2099-09-01T15:00:00.000Z');

function accessFor(status: string) {
  return {
    ok: true,
    actorRole: 'admin',
    salon: { id: SALON_ID, slug: 'patch-guard-salon', name: 'Patch Guard' },
    appointment: {
      id: APPT_ID,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      salonClientId: CLIENT_ID,
      clientPhone: '4165550000',
      clientName: 'Hold Client',
      clientEmail: null,
      startTime: START,
      endTime: END,
      status,
      canvasState: 'waiting',
      googleCalendarEventId: null,
      totalPrice: 4500,
      totalDurationMinutes: 60,
    },
  };
}

function patchRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/appointments/${APPT_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedAppointment(status: string) {
  await db.insert(schema.appointmentSchema).values({
    id: APPT_ID,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    salonClientId: CLIENT_ID,
    clientPhone: '4165550000',
    clientName: 'Hold Client',
    startTime: START,
    endTime: END,
    status,
    canvasState: 'waiting',
    totalPrice: 4500,
    totalDurationMinutes: 60,
    invoiceCurrency: 'CAD',
    ...(status === 'awaiting_payment'
      ? { depositHoldExpiresAt: new Date(Date.now() + 30 * 60_000) }
      : {}),
  });
  await db.insert(schema.appointmentDepositSchema).values({
    id: DEPOSIT_ID,
    salonId: SALON_ID,
    appointmentId: APPT_ID,
    status: 'checkout_created',
    amountCents: 2500,
    currency: 'cad',
    stripeAccountId: 'acct_live',
  });
}

async function readBack() {
  const [appointment] = await db.select().from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, APPT_ID));
  const [deposit] = await db.select().from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
  return { appointment, deposit };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Patch Guard Salon',
    slug: 'patch-guard-salon',
    ownerEmail: 'owner@example.com',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
  });
  await db.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    phone: '4165550000',
  });
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
});

afterAll(async () => {
  await client.close();
});

describe('§5.8 — PATCH /api/appointments/:id refuses holds', () => {
  it.each([['confirmed'], ['completed'], ['cancelled'], ['no_show']])(
    'target %s against a hold -> 409 HOLD_LOCKED, row unchanged',
    async (target) => {
      await seedAppointment('awaiting_payment');
      holder.access = accessFor('awaiting_payment');

      const response = await PATCH(patchRequest({ status: target }), {
        params: Promise.resolve({ id: APPT_ID }),
      });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.code).toBe('HOLD_LOCKED');

      const after = await readBack();

      // The blind writer was never reached.
      expect(after.appointment!.status).toBe('awaiting_payment');
      expect(after.deposit!.status).toBe('checkout_created');
    },
  );

  it('refuses a WRITE of awaiting_payment onto a normal appointment -> 400', async () => {
    // The other direction: this status is reachable only by the booking
    // transaction that creates the hold. Letting it in here would manufacture a
    // hold with no deposit row behind it and nothing to reap it.
    await seedAppointment('confirmed');
    holder.access = accessFor('confirmed');

    const response = await PATCH(patchRequest({ status: 'awaiting_payment' }), {
      params: Promise.resolve({ id: APPT_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect((await readBack()).appointment!.status).toBe('confirmed');
  });

  it('CONTROL: a normal cancellation on a non-hold still commits', async () => {
    // Without this the suite would pass against a PATCH that refused everything.
    await seedAppointment('confirmed');
    holder.access = accessFor('confirmed');

    const response = await PATCH(patchRequest({
      status: 'cancelled',
      cancelReason: 'client_request',
    }), {
      params: Promise.resolve({ id: APPT_ID }),
    });

    expect(response.status).toBe(200);
    expect((await readBack()).appointment!.status).toBe('cancelled');
  });

  it('atomically releases the generic owner no-show\'s exact reward link', async () => {
    await seedAppointment('confirmed');
    holder.access = accessFor('confirmed');
    await db.insert(schema.rewardSchema).values([
      {
        id: 'reward_generic_no_show_decoy',
        salonId: SALON_ID,
        clientPhone: '4165550000',
        type: 'referral_referee',
        discountType: 'fixed_amount',
        discountAmountCents: 1000,
      },
      {
        id: 'reward_generic_no_show_exact',
        salonId: SALON_ID,
        clientPhone: '4165550000',
        type: 'referral_referee',
        discountType: 'fixed_amount',
        discountAmountCents: 1000,
        usedInAppointmentId: APPT_ID,
      },
    ]);

    const response = await PATCH(patchRequest({ status: 'no_show' }), {
      params: Promise.resolve({ id: APPT_ID }),
    });

    expect(response.status).toBe(200);
    expect((await readBack()).appointment).toMatchObject({
      status: 'no_show',
      cancelReason: 'no_show',
    });
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_generic_no_show_exact')))[0]?.usedInAppointmentId)
      .toBeNull();
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_generic_no_show_decoy')))[0]?.usedInAppointmentId)
      .toBeNull();
  });

  it('atomically freezes a collected deposit when the generic owner marks no-show', async () => {
    await seedAppointment('confirmed');
    holder.access = accessFor('confirmed');
    await db
      .update(schema.appointmentDepositSchema)
      .set({
        status: 'paid',
        stripeCheckoutSessionId: 'cs_patch_guard',
        stripePaymentIntentId: 'pi_patch_guard',
        collectedAt: new Date('2099-09-01T13:00:00.000Z'),
      })
      .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));

    const response = await PATCH(patchRequest({ status: 'no_show' }), {
      params: Promise.resolve({ id: APPT_ID }),
    });

    expect(response.status).toBe(200);

    const { deposit } = await readBack();

    expect(deposit?.forfeitedAt).toBeInstanceOf(Date);
    expect(deposit?.forfeitureTaxSnapshot).toMatchObject({
      currency: 'CAD',
      grossForfeitedCents: 2_500,
      kind: 'forfeiture_estimate',
    });
  });

  it('rolls back the no-show and returns the typed refund block for an in-flight refund', async () => {
    await seedAppointment('confirmed');
    holder.access = accessFor('confirmed');
    const refundRequestedAt = new Date('2099-09-01T13:30:00.000Z');
    await db
      .update(schema.appointmentDepositSchema)
      .set({
        status: 'paid',
        stripeCheckoutSessionId: 'cs_patch_guard_pending',
        stripePaymentIntentId: 'pi_patch_guard_pending',
        collectedAt: new Date('2099-09-01T13:00:00.000Z'),
        refundStatus: 'pending',
        refundRequestedAt,
        refundStatusChangedAt: refundRequestedAt,
      })
      .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));

    const response = await PATCH(patchRequest({ status: 'no_show' }), {
      params: Promise.resolve({ id: APPT_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DEPOSIT_REFUND_IN_FLIGHT');

    const state = await readBack();

    expect(state.appointment?.status).toBe('confirmed');
    expect(state.deposit?.forfeitedAt).toBeNull();
  });

  it('atomically releases the generic owner cancellation\'s exact reward link', async () => {
    await seedAppointment('confirmed');
    holder.access = accessFor('confirmed');
    await db.insert(schema.rewardSchema).values([
      {
        id: 'reward_generic_cancel_decoy',
        salonId: SALON_ID,
        clientPhone: '4165550000',
        type: 'referral_referee',
        discountType: 'fixed_amount',
        discountAmountCents: 1000,
      },
      {
        id: 'reward_generic_cancel_exact',
        salonId: SALON_ID,
        clientPhone: '4165550000',
        type: 'referral_referee',
        discountType: 'fixed_amount',
        discountAmountCents: 1000,
        usedInAppointmentId: APPT_ID,
      },
    ]);

    const response = await PATCH(patchRequest({
      status: 'cancelled',
      cancelReason: 'client_request',
    }), { params: Promise.resolve({ id: APPT_ID }) });

    expect(response.status).toBe(200);
    expect((await readBack()).appointment).toMatchObject({
      status: 'cancelled',
      cancelReason: 'client_request',
    });
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_generic_cancel_exact')))[0]?.usedInAppointmentId)
      .toBeNull();
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_generic_cancel_decoy')))[0]?.usedInAppointmentId)
      .toBeNull();
  });
});
