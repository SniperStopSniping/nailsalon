/**
 * Payment-link + public pay page integration (PGlite, real SQL, real routes).
 * Pins the security contract: 256-bit token, hashed at rest, revoked on full
 * payment; the public payload never contains client PII.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildBookingTaxSnapshot,
  buildFinalTaxSnapshot,
  DISABLED_TAX_CONFIG,
  type FinalTaxSnapshot,
} from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { POST as mintPaymentLink } from '../../../appointments/[id]/payment-link/route';
import { POST as recordPayment } from '../../../appointments/[id]/payments/route';
import { GET as getPayPage } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  access: { actorRole: 'admin' as const, salonId: 'salon_pay' },
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess: vi.fn(async (appointmentId: string) => {
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
    return {
      ok: true,
      actorRole: 'admin',
      admin: { id: 'admin_pay', name: 'Pay Admin' },
      appointment,
    };
  }),
}));

vi.mock('@/libs/fraudDetection', () => ({
  evaluateAndFlagIfNeeded: vi.fn(async () => undefined),
}));

const SALON_ID = 'salon_pay';
const APPT_ID = 'appt_pay_1';
const OTHER_APPT_ID = 'appt_pay_2';
const ESTIMATE_APPT_ID = 'appt_pay_estimate';
const TERMINAL_APPT_ID = 'appt_pay_terminal';
const HISTORICAL_APPT_ID = 'appt_pay_historical_currency_unknown';
const LEGACY_REFUNDED_APPT_ID = 'appt_pay_legacy_refunded';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Pay Salon',
    slug: 'pay-salon',
    settings: {
      payments: {
        etransfer: {
          enabled: true,
          recipient: 'pay@paysalon.ca',
          recipientName: 'Pay Salon',
          qrPageEnabled: true,
          requireReference: true,
          instructions: 'Include the reference.',
        },
      },
    },
  });
  await db.insert(schema.appointmentSchema).values([
    {
      id: APPT_ID,
      salonId: SALON_ID,
      clientPhone: '4165550177',
      clientName: 'Private Client Name',
      startTime: new Date('2026-07-10T14:00:00Z'),
      endTime: new Date('2026-07-10T15:00:00Z'),
      status: 'completed',
      completedAt: new Date('2026-07-10T15:00:00Z'),
      totalPrice: 10000,
      totalDurationMinutes: 60,
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 0,
      paymentStatus: 'pending',
      amountPaidCents: 0,
      invoiceCurrency: 'CAD',
    },
    {
      id: OTHER_APPT_ID,
      salonId: SALON_ID,
      clientPhone: '4165550178',
      startTime: new Date('2026-07-11T14:00:00Z'),
      endTime: new Date('2026-07-11T15:00:00Z'),
      status: 'completed',
      completedAt: new Date('2026-07-11T15:00:00Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
      finalPriceCents: 5000,
      taxAmountCents: 0,
      tipCents: 0,
      paymentStatus: 'pending',
      amountPaidCents: 0,
      invoiceCurrency: 'CAD',
    },
    {
      id: ESTIMATE_APPT_ID,
      salonId: SALON_ID,
      clientPhone: '4165550179',
      startTime: new Date('2026-07-12T14:00:00Z'),
      endTime: new Date('2026-07-12T15:00:00Z'),
      status: 'confirmed',
      totalPrice: 11300,
      totalDurationMinutes: 60,
      paymentStatus: 'pending',
      amountPaidCents: 0,
      invoiceCurrency: 'CAD',
    },
    {
      id: TERMINAL_APPT_ID,
      salonId: SALON_ID,
      clientPhone: '4165550180',
      startTime: new Date('2026-07-13T14:00:00Z'),
      endTime: new Date('2026-07-13T15:00:00Z'),
      status: 'completed',
      completedAt: new Date('2026-07-13T15:00:00Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
      finalPriceCents: 5000,
      taxAmountCents: 0,
      tipCents: 0,
      paymentStatus: 'pending',
      amountPaidCents: 0,
      invoiceCurrency: 'CAD',
    },
    {
      id: HISTORICAL_APPT_ID,
      salonId: SALON_ID,
      clientPhone: '4165550181',
      startTime: new Date('2026-07-14T14:00:00Z'),
      endTime: new Date('2026-07-14T15:00:00Z'),
      status: 'completed',
      completedAt: new Date('2026-07-14T15:00:00Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
      finalPriceCents: 5000,
      taxAmountCents: 0,
      paymentStatus: 'pending',
      amountPaidCents: 0,
    },
    {
      id: LEGACY_REFUNDED_APPT_ID,
      salonId: SALON_ID,
      clientPhone: '4165550182',
      startTime: new Date('2026-07-15T14:00:00Z'),
      endTime: new Date('2026-07-15T15:00:00Z'),
      status: 'completed',
      completedAt: new Date('2026-07-15T15:00:00Z'),
      totalPrice: 10000,
      totalDurationMinutes: 60,
      finalPriceCents: 10000,
      taxAmountCents: 0,
      tipCents: 0,
      paymentStatus: 'pending',
      amountPaidCents: null,
      invoiceCurrency: 'CAD',
    },
  ]);
  await db.insert(schema.appointmentDepositSchema).values({
    id: 'deposit_pay_legacy_refunded',
    salonId: SALON_ID,
    appointmentId: LEGACY_REFUNDED_APPT_ID,
    amountCents: 2500,
    currency: 'cad',
    status: 'refunded',
    stripeAccountId: 'acct_pay',
    stripePaymentIntentId: 'pi_pay_legacy_refunded',
    stripeRefundId: 're_pay_legacy_refunded',
    refundStatus: 'succeeded',
    refundStatusChangedAt: new Date('2026-08-15T12:00:00.000Z'),
    refundAmountCents: 2500,
    refundedAt: new Date('2026-08-15T12:00:00.000Z'),
  });
}, 60_000);

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterAll(async () => {
  await client.close();
});

async function mintToken(appointmentId: string): Promise<string> {
  const response = await mintPaymentLink(
    new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
    { params: Promise.resolve({ id: appointmentId }) },
  );

  expect(response.status).toBe(200);

  const { data } = await response.json();
  return String(data.url).split('/pay/')[1]!;
}

describe('payment link + public pay page', () => {
  it('refuses to mint payment instructions from an editable booking estimate', async () => {
    const response = await mintPaymentLink(
      new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
      { params: Promise.resolve({ id: ESTIMATE_APPT_ID }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVOICE_NOT_FINALIZED' },
    });
  });

  it('serves salon-side payment facts only — never client PII', async () => {
    const token = await mintToken(APPT_ID);

    const response = await getPayPage(
      new Request(`http://localhost/api/public/pay/${token}`),
      { params: Promise.resolve({ token }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      salonName: 'Pay Salon',
      amountDueCents: 11300, // 10000 + 1300 tax, nothing paid
      currency: 'CAD',
      isFinalized: true,
      recipient: 'pay@paysalon.ca',
    });
    expect(body.data.reference).toMatch(/^LSTR-/);

    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('Private Client Name');
    expect(serialized).not.toContain('4165550177');
  });

  it('stops serving instructions after the appointment becomes terminal', async () => {
    const token = await mintToken(TERMINAL_APPT_ID);

    await db.update(schema.appointmentSchema)
      .set({ status: 'no_show' })
      .where(eq(schema.appointmentSchema.id, TERMINAL_APPT_ID));

    const response = await getPayPage(
      new Request(`http://localhost/api/public/pay/${token}`),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PAYMENT_LINK_INVALID' },
    });
  });

  it('does not create a collection link for a historical invoice with unknown currency', async () => {
    const response = await mintPaymentLink(
      new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
      { params: Promise.resolve({ id: HISTORICAL_APPT_ID }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVOICE_CURRENCY_UNAVAILABLE' },
    });
  });

  it('fails mint and public collection closed on malformed or currency-drifted final snapshots', async () => {
    const validSnapshot = buildFinalTaxSnapshot({
      taxConfig: DISABLED_TAX_CONFIG,
      totals: {
        taxApplied: false,
        taxableSubtotalCents: 0,
        taxAmountCents: 0,
        finalPriceCents: 5000,
      },
      capturedAt: new Date('2026-07-11T15:00:00.000Z'),
      currency: 'CAD',
      taxExempt: false,
    });

    await db.update(schema.appointmentSchema).set({
      finalTaxSnapshot: validSnapshot,
      taxableSubtotalCents: 0,
      taxExempt: false,
      taxExemptReason: null,
    }).where(eq(schema.appointmentSchema.id, OTHER_APPT_ID));
    const token = await mintToken(OTHER_APPT_ID);

    try {
      await db.update(schema.appointmentSchema).set({
        finalTaxSnapshot: { malformed: true } as unknown as FinalTaxSnapshot,
      }).where(eq(schema.appointmentSchema.id, OTHER_APPT_ID));

      const malformedPublic = await getPayPage(
        new Request(`http://localhost/api/public/pay/${token}`),
        { params: Promise.resolve({ token }) },
      );

      expect(malformedPublic.status).toBe(409);
      await expect(malformedPublic.json()).resolves.toMatchObject({
        error: {
          code: 'TAX_SNAPSHOT_INVALID',
          reason: 'TAX_SNAPSHOT_SCHEMA_UNSUPPORTED',
        },
      });

      const malformedMint = await mintPaymentLink(
        new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
        { params: Promise.resolve({ id: OTHER_APPT_ID }) },
      );

      expect(malformedMint.status).toBe(409);
      await expect(malformedMint.json()).resolves.toMatchObject({
        error: {
          code: 'TAX_SNAPSHOT_INVALID',
          reason: 'TAX_SNAPSHOT_SCHEMA_UNSUPPORTED',
        },
      });

      await db.update(schema.appointmentSchema).set({
        finalTaxSnapshot: validSnapshot,
        invoiceCurrency: 'USD',
      }).where(eq(schema.appointmentSchema.id, OTHER_APPT_ID));

      const driftedPublic = await getPayPage(
        new Request(`http://localhost/api/public/pay/${token}`),
        { params: Promise.resolve({ token }) },
      );

      expect(driftedPublic.status).toBe(409);
      await expect(driftedPublic.json()).resolves.toMatchObject({
        error: {
          code: 'TAX_SNAPSHOT_INVALID',
          reason: 'TAX_SNAPSHOT_CURRENCY_MISMATCH',
        },
      });

      const driftedMint = await mintPaymentLink(
        new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
        { params: Promise.resolve({ id: OTHER_APPT_ID }) },
      );

      expect(driftedMint.status).toBe(409);
      await expect(driftedMint.json()).resolves.toMatchObject({
        error: {
          code: 'TAX_SNAPSHOT_INVALID',
          reason: 'TAX_SNAPSHOT_CURRENCY_MISMATCH',
        },
      });
    } finally {
      await db.update(schema.appointmentSchema).set({
        finalTaxSnapshot: null,
        taxableSubtotalCents: null,
        taxExempt: null,
        taxExemptReason: null,
        invoiceCurrency: 'CAD',
      }).where(eq(schema.appointmentSchema.id, OTHER_APPT_ID));
    }
  });

  it('fails mint and public collection closed when a finalized snapshot is deleted', async () => {
    const token = await mintToken(OTHER_APPT_ID);
    const bookingTaxSnapshot = buildBookingTaxSnapshot({
      taxConfig: DISABLED_TAX_CONFIG,
      totals: {
        taxApplied: false,
        taxableSubtotalCents: 0,
        taxAmountCents: 0,
        finalPriceCents: 5000,
      },
      capturedAt: new Date('2026-07-11T14:00:00.000Z'),
      currency: 'CAD',
    });

    await db.update(schema.appointmentSchema).set({
      bookingTaxSnapshot,
      finalTaxSnapshot: null,
    }).where(eq(schema.appointmentSchema.id, OTHER_APPT_ID));

    try {
      const publicResponse = await getPayPage(
        new Request(`http://localhost/api/public/pay/${token}`),
        { params: Promise.resolve({ token }) },
      );

      expect(publicResponse.status).toBe(409);
      await expect(publicResponse.json()).resolves.toMatchObject({
        error: {
          code: 'TAX_SNAPSHOT_INVALID',
          reason: 'TAX_SNAPSHOT_INVALID_SHAPE',
        },
      });

      const mintResponse = await mintPaymentLink(
        new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
        { params: Promise.resolve({ id: OTHER_APPT_ID }) },
      );

      expect(mintResponse.status).toBe(409);
      await expect(mintResponse.json()).resolves.toMatchObject({
        error: {
          code: 'TAX_SNAPSHOT_INVALID',
          reason: 'TAX_SNAPSHOT_INVALID_SHAPE',
        },
      });
    } finally {
      await db.update(schema.appointmentSchema).set({
        bookingTaxSnapshot: null,
      }).where(eq(schema.appointmentSchema.id, OTHER_APPT_ID));
    }
  });

  it('does not recollect a historical paid invoice after a deposit refund erases the paid scalar', async () => {
    const response = await mintPaymentLink(
      new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
      { params: Promise.resolve({ id: LEGACY_REFUNDED_APPT_ID }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED' },
    });
  });

  it('stores only the token hash, and a token cannot reach another appointment', async () => {
    const token = await mintToken(APPT_ID);

    const [link] = await db
      .select()
      .from(schema.appointmentPaymentLinkSchema)
      .where(eq(schema.appointmentPaymentLinkSchema.appointmentId, APPT_ID));

    expect(link!.tokenHash).not.toContain(token);

    // A token for appointment 1 resolves ONLY appointment 1's amounts — mint a
    // token for appointment 2 and confirm the payloads differ; garbage 404s.
    const otherToken = await mintToken(OTHER_APPT_ID);
    const otherResponse = await getPayPage(
      new Request(`http://localhost/api/public/pay/${otherToken}`),
      { params: Promise.resolve({ token: otherToken }) },
    );

    expect((await otherResponse.json()).data.amountDueCents).toBe(5000);

    const garbage = await getPayPage(
      new Request('http://localhost/api/public/pay/not-a-token'),
      { params: Promise.resolve({ token: 'not-a-token' }) },
    );

    expect(garbage.status).toBe(404);
  });

  it('blocks every collection surface when a positive paid cache has no ledger provenance', async () => {
    const token = await mintToken(APPT_ID);
    await db.update(schema.appointmentSchema)
      .set({ amountPaidCents: 2500 })
      .where(eq(schema.appointmentSchema.id, APPT_ID));

    try {
      const publicResponse = await getPayPage(
        new Request(`http://localhost/api/public/pay/${token}`),
        { params: Promise.resolve({ token }) },
      );

      expect(publicResponse.status).toBe(409);
      await expect(publicResponse.json()).resolves.toMatchObject({
        error: { code: 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED' },
      });

      const mintResponse = await mintPaymentLink(
        new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
        { params: Promise.resolve({ id: APPT_ID }) },
      );

      expect(mintResponse.status).toBe(409);
      await expect(mintResponse.json()).resolves.toMatchObject({
        error: { code: 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED' },
      });

      const paymentResponse = await recordPayment(
        new Request('http://localhost/api/appointments/x/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amountCents: 100,
            method: 'e_transfer',
            idempotencyKey: 'blocked-cache-without-ledger',
          }),
        }),
        { params: Promise.resolve({ id: APPT_ID }) },
      );

      expect(paymentResponse.status).toBe(409);
      await expect(paymentResponse.json()).resolves.toMatchObject({
        error: { code: 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED' },
      });
    } finally {
      await db.update(schema.appointmentSchema)
        .set({ amountPaidCents: 0 })
        .where(eq(schema.appointmentSchema.id, APPT_ID));
    }
  });

  it('blocks public, link, and payment surfaces when a late deposit creates tender excess', async () => {
    const token = await mintToken(OTHER_APPT_ID);
    await db.insert(schema.appointmentPaymentSchema).values({
      id: 'pay_late_deposit_overpayment',
      appointmentId: OTHER_APPT_ID,
      salonId: SALON_ID,
      amountCents: 5000,
      recordedByType: 'staff',
      recordedById: 'tech_pay',
    });
    await db.insert(schema.appointmentDepositSchema).values({
      id: 'deposit_late_overpayment',
      appointmentId: OTHER_APPT_ID,
      salonId: SALON_ID,
      amountCents: 2500,
      currency: 'cad',
      status: 'paid',
      stripeAccountId: 'acct_pay',
      stripePaymentIntentId: 'pi_late_overpayment',
      collectedAt: new Date('2026-07-11T16:00:00.000Z'),
    });
    await db.update(schema.appointmentSchema).set({
      amountPaidCents: 5000,
      paymentStatus: 'pending',
    }).where(eq(schema.appointmentSchema.id, OTHER_APPT_ID));

    try {
      const publicResponse = await getPayPage(
        new Request(`http://localhost/api/public/pay/${token}`),
        { params: Promise.resolve({ token }) },
      );

      expect(publicResponse.status).toBe(409);
      await expect(publicResponse.json()).resolves.toMatchObject({
        error: {
          code: 'APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED',
        },
      });

      const mintResponse = await mintPaymentLink(
        new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
        { params: Promise.resolve({ id: OTHER_APPT_ID }) },
      );

      expect(mintResponse.status).toBe(409);
      await expect(mintResponse.json()).resolves.toMatchObject({
        error: {
          code: 'APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED',
        },
      });

      const paymentResponse = await recordPayment(
        new Request('http://localhost/api/appointments/x/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amountCents: 100,
            method: 'e_transfer',
            idempotencyKey: 'blocked-late-deposit-overpayment',
          }),
        }),
        { params: Promise.resolve({ id: OTHER_APPT_ID }) },
      );

      expect(paymentResponse.status).toBe(409);
      await expect(paymentResponse.json()).resolves.toMatchObject({
        error: {
          code: 'APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED',
        },
      });
    } finally {
      await db.delete(schema.appointmentDepositSchema)
        .where(eq(schema.appointmentDepositSchema.id, 'deposit_late_overpayment'));
      await db.delete(schema.appointmentPaymentSchema)
        .where(eq(schema.appointmentPaymentSchema.id, 'pay_late_deposit_overpayment'));
      await db.update(schema.appointmentSchema).set({
        amountPaidCents: 0,
        paymentStatus: 'pending',
      }).where(eq(schema.appointmentSchema.id, OTHER_APPT_ID));
    }
  });

  it('revokes the link once the balance is fully paid', async () => {
    const token = await mintToken(APPT_ID);

    const paymentResponse = await recordPayment(
      new Request('http://localhost/api/appointments/x/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents: 11300,
          method: 'e_transfer',
          idempotencyKey: 'public-pay-integration-1',
        }),
      }),
      { params: Promise.resolve({ id: APPT_ID }) },
    );

    expect(paymentResponse.status).toBe(200);
    expect((await paymentResponse.json()).data.paymentStatus).toBe('paid');

    const afterPaid = await getPayPage(
      new Request(`http://localhost/api/public/pay/${token}`),
      { params: Promise.resolve({ token }) },
    );

    expect(afterPaid.status).toBe(404);
  });

  it('minting again supersedes the previous link', async () => {
    const first = await mintToken(OTHER_APPT_ID);
    const second = await mintToken(OTHER_APPT_ID);

    const firstResponse = await getPayPage(
      new Request(`http://localhost/api/public/pay/${first}`),
      { params: Promise.resolve({ token: first }) },
    );
    const secondResponse = await getPayPage(
      new Request(`http://localhost/api/public/pay/${second}`),
      { params: Promise.resolve({ token: second }) },
    );

    expect(firstResponse.status).toBe(404);
    expect(secondResponse.status).toBe(200);
  });
});
