import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import type {
  DepositForfeitureBlockedError,
} from './depositForfeiture';
import {
  forfeitAppointmentDepositInTx,
  forfeitCancelledAppointmentDepositForOwnerInTx,
} from './depositForfeiture';
/* eslint-enable import/first */

const SALON_ID = 'salon_forfeiture';
const APPOINTMENT_ID = 'appt_forfeiture';
const DEPOSIT_ID = 'dep_forfeiture';
const AMOUNT_CENTS = 2_500;

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedAppointment(
  invoiceCurrency: string | null = 'CAD',
  status = 'confirmed',
) {
  await db.insert(schema.appointmentSchema).values({
    id: APPOINTMENT_ID,
    salonId: SALON_ID,
    clientPhone: '4165550100',
    clientName: 'Forfeiture Client',
    startTime: new Date('2026-08-15T14:00:00.000Z'),
    endTime: new Date('2026-08-15T15:00:00.000Z'),
    status,
    totalPrice: 9_000,
    totalDurationMinutes: 60,
    invoiceCurrency,
  });
}

async function applyOwnerForfeiture(forfeitedAt: Date) {
  return db.transaction(async (tx) => {
    await tx
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID))
      .for('update')
      .limit(1);
    return forfeitCancelledAppointmentDepositForOwnerInTx({
      tx,
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      invoiceCurrency: 'CAD',
      forfeitedAt,
      appointmentLockHeld: true,
      ownerAction: {
        performedBy: 'owner_1',
        performedByName: 'Owner One',
        reason: 'Client cancelled outside the retained-deposit window.',
      },
    });
  });
}

async function seedDeposit(overrides: Partial<typeof schema.appointmentDepositSchema.$inferInsert> = {}) {
  await db.insert(schema.appointmentDepositSchema).values({
    id: DEPOSIT_ID,
    salonId: SALON_ID,
    appointmentId: APPOINTMENT_ID,
    amountCents: AMOUNT_CENTS,
    currency: 'cad',
    status: 'paid',
    stripeAccountId: 'acct_forfeiture',
    stripeCheckoutSessionId: 'cs_forfeiture',
    stripePaymentIntentId: 'pi_forfeiture',
    collectedAt: new Date('2026-08-14T13:00:00.000Z'),
    ...overrides,
  });
}

async function applyForfeiture(forfeitedAt: Date, invoiceCurrency: string | null = 'CAD') {
  return db.transaction(async (tx) => {
    const [appointment] = await tx
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID))
      .for('update')
      .limit(1);
    if (!appointment) {
      throw new Error('missing appointment fixture');
    }
    return forfeitAppointmentDepositInTx({
      tx,
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      invoiceCurrency,
      forfeitedAt,
      appointmentLockHeld: true,
    });
  });
}

async function readDeposit() {
  const [deposit] = await db
    .select()
    .from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
  return deposit;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60_000);

beforeEach(async () => {
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Forfeiture Salon',
    slug: 'forfeiture-salon',
    ownerEmail: 'owner@example.com',
    settings: {
      payments: {
        tax: {
          enabled: true,
          name: 'HST',
          rateBps: 1_300,
          pricesIncludeTax: true,
          forfeitureTaxEstimationEnabled: true,
          country: 'CA',
          region: 'ON',
          jurisdiction: 'Ontario',
        },
      },
    },
  });
});

afterAll(async () => {
  await client.close();
});

describe('forfeitAppointmentDepositInTx', () => {
  it('atomically freezes a retained paid deposit and reviewed tax estimate', async () => {
    await seedAppointment();
    await seedDeposit();
    const forfeitedAt = new Date('2026-08-15T15:01:00.000Z');

    await expect(applyForfeiture(forfeitedAt)).resolves.toEqual({
      disposition: 'forfeited',
      depositIds: [DEPOSIT_ID],
      forfeitedCents: AMOUNT_CENTS,
    });

    const deposit = await readDeposit();

    expect(deposit?.forfeitedAt).toEqual(forfeitedAt);
    expect(deposit?.forfeitureTaxSnapshot).toMatchObject({
      kind: 'forfeiture_estimate',
      classification: 'estimate',
      capturedAt: forfeitedAt.toISOString(),
      currency: 'CAD',
      grossForfeitedCents: AMOUNT_CENTS,
      taxEstimateApplied: true,
      estimatedTaxIncludedCents: 288,
      estimatedNetCents: 2_212,
      configuration: {
        label: 'HST',
        rateBps: 1_300,
        country: 'CA',
        region: 'ON',
      },
    });

    const audits = await db.select().from(schema.appointmentAuditLogSchema)
      .where(eq(schema.appointmentAuditLogSchema.appointmentId, APPOINTMENT_ID));

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'deposit_forfeited',
      performedBy: 'system',
      performedByRole: 'system',
      reason: 'Collected deposit retained after no-show.',
      newValue: {
        depositId: DEPOSIT_ID,
        appointmentId: APPOINTMENT_ID,
        trigger: 'no_show',
        origin: 'd6_1_forfeiture',
      },
    });
  });

  it('is idempotent and never replaces the original timestamp or snapshot', async () => {
    await seedAppointment();
    await seedDeposit();
    const firstAt = new Date('2026-08-15T15:01:00.000Z');
    await applyForfeiture(firstAt);
    const first = await readDeposit();

    await expect(applyForfeiture(new Date('2026-08-16T15:01:00.000Z'))).resolves.toEqual({
      disposition: 'already_forfeited',
      depositIds: [DEPOSIT_ID],
      forfeitedCents: AMOUNT_CENTS,
    });

    const second = await readDeposit();

    expect(second?.forfeitedAt).toEqual(firstAt);
    expect(second?.forfeitureTaxSnapshot).toEqual(first?.forfeitureTaxSnapshot);
    expect(await db.select().from(schema.appointmentAuditLogSchema)
      .where(eq(schema.appointmentAuditLogSchema.appointmentId, APPOINTMENT_ID)))
      .toHaveLength(1);
  });

  it('supports an explicit owner retain action only for a cancelled appointment', async () => {
    await seedAppointment('CAD', 'cancelled');
    await seedDeposit();
    const forfeitedAt = new Date('2026-08-15T15:01:00.000Z');

    await expect(applyOwnerForfeiture(forfeitedAt)).resolves.toMatchObject({
      disposition: 'forfeited',
      forfeitedCents: AMOUNT_CENTS,
    });

    const audits = await db.select().from(schema.appointmentAuditLogSchema)
      .where(eq(schema.appointmentAuditLogSchema.appointmentId, APPOINTMENT_ID));

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'deposit_forfeited',
      performedBy: 'owner_1',
      performedByRole: 'admin',
      performedByName: 'Owner One',
      reason: 'Client cancelled outside the retained-deposit window.',
      newValue: { trigger: 'owner_cancelled' },
    });
  });

  it('rejects an owner retain action unless the locked appointment is cancelled', async () => {
    await seedAppointment();
    await seedDeposit();

    await expect(applyOwnerForfeiture(new Date())).rejects.toMatchObject({
      code: 'DEPOSIT_FORFEITURE_INVALID_APPOINTMENT_STATE',
    });
    expect((await readDeposit())?.forfeitedAt).toBeNull();
  });

  it('does nothing for an appointment with no deposit, even when legacy currency is unknown', async () => {
    await seedAppointment(null);

    await expect(applyForfeiture(new Date(), null)).resolves.toEqual({
      disposition: 'no_deposit',
      depositIds: [],
      forfeitedCents: 0,
    });
  });

  it('does not forfeit waived or otherwise uncollected deposits', async () => {
    await seedAppointment();
    await seedDeposit({
      status: 'waived',
      stripePaymentIntentId: null,
      collectedAt: null,
      waivedAt: new Date('2026-08-15T12:00:00.000Z'),
      waivedBy: 'owner',
      waiverReason: 'courtesy',
    });

    await expect(applyForfeiture(new Date())).resolves.toEqual({
      disposition: 'uncollected',
      depositIds: [],
      forfeitedCents: 0,
    });
    expect((await readDeposit())?.forfeitedAt).toBeNull();
  });

  it('keeps immutable forfeiture evidence after a later full refund succeeds', async () => {
    await seedAppointment();
    await seedDeposit();
    const forfeitedAt = new Date('2026-08-15T15:01:00.000Z');
    await applyForfeiture(forfeitedAt);
    const originalSnapshot = (await readDeposit())?.forfeitureTaxSnapshot;
    const refundedAt = new Date('2026-08-16T12:00:00.000Z');
    await db
      .update(schema.appointmentDepositSchema)
      .set({
        status: 'refunded',
        stripeRefundId: 're_forfeiture',
        refundedAt,
        refundStatus: 'succeeded',
        refundStatusChangedAt: refundedAt,
        refundAmountCents: AMOUNT_CENTS,
      })
      .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));

    await expect(applyForfeiture(new Date('2026-08-17T12:00:00.000Z'))).resolves.toEqual({
      disposition: 'fully_refunded',
      depositIds: [DEPOSIT_ID],
      forfeitedCents: AMOUNT_CENTS,
    });

    const refunded = await readDeposit();

    expect(refunded?.forfeitedAt).toEqual(forfeitedAt);
    expect(refunded?.forfeitureTaxSnapshot).toEqual(originalSnapshot);
  });

  it.each([
    ['pending refund', {
      refundStatus: 'pending',
      refundRequestedAt: new Date('2026-08-15T14:30:00.000Z'),
      refundStatusChangedAt: new Date('2026-08-15T14:30:00.000Z'),
    }, 'DEPOSIT_REFUND_IN_FLIGHT'],
    ['failed refund', {
      refundStatus: 'failed',
      refundRequestedAt: new Date('2026-08-15T14:30:00.000Z'),
      refundStatusChangedAt: new Date('2026-08-15T14:30:00.000Z'),
      refundLastErrorCode: 'UNKNOWN_PROVIDER_ERROR',
      refundFailureReason: 'unknown',
    }, 'DEPOSIT_REFUND_UNRESOLVED'],
    ['partial refund', {
      status: 'refunded',
      stripeRefundId: 're_partial',
      refundedAt: new Date('2026-08-15T14:30:00.000Z'),
      refundStatus: 'succeeded',
      refundStatusChangedAt: new Date('2026-08-15T14:30:00.000Z'),
      refundAmountCents: 1_000,
    }, 'DEPOSIT_PARTIAL_REFUND_UNSUPPORTED'],
    ['provider conflict', {
      refundConflictFlag: true,
    }, 'DEPOSIT_REFUND_CONFLICT'],
  ] as const)(
    'blocks %s with a typed code and writes no forfeiture evidence',
    async (_label, overrides, expectedCode) => {
      await seedAppointment();
      await seedDeposit(overrides);

      await expect(applyForfeiture(new Date())).rejects.toMatchObject({
        name: 'DepositForfeitureBlockedError',
        code: expectedCode,
        depositIds: [DEPOSIT_ID],
      } satisfies Partial<DepositForfeitureBlockedError>);
      expect((await readDeposit())?.forfeitedAt).toBeNull();
    },
  );

  it('rolls back a no-show appointment write when refund state blocks forfeiture', async () => {
    await seedAppointment();
    await seedDeposit({
      refundStatus: 'pending',
      refundRequestedAt: new Date('2026-08-15T14:30:00.000Z'),
      refundStatusChangedAt: new Date('2026-08-15T14:30:00.000Z'),
    });

    await expect(db.transaction(async (tx) => {
      const [appointment] = await tx
        .select()
        .from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID))
        .for('update')
        .limit(1);
      await tx
        .update(schema.appointmentSchema)
        .set({ status: 'no_show', cancelReason: 'no_show' })
        .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
      await forfeitAppointmentDepositInTx({
        tx,
        salonId: SALON_ID,
        appointmentId: APPOINTMENT_ID,
        invoiceCurrency: appointment?.invoiceCurrency ?? null,
        forfeitedAt: new Date(),
        appointmentLockHeld: true,
      });
    })).rejects.toMatchObject({ code: 'DEPOSIT_REFUND_IN_FLIGHT' });

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    expect(appointment?.status).toBe('confirmed');
  });
});
