import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { buildFinalTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { GET } from './route';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock('@/libs/superAdmin', () => ({ requireSuperAdmin: vi.fn(async () => null) }));

const SALON_ID = 'salon_export_d6_1';
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('super-admin salon export D6.1 evidence', () => {
  it('exports frozen invoice identity plus raw deposit, tender, item, and audit ledgers', async () => {
    const capturedAt = new Date('2026-08-15T12:00:00.000Z');
    const totals = computeCheckoutTotals({
      items: [{ lineTotalCents: 10_000, taxable: false }],
      discountCents: 0,
      taxConfig: DISABLED_TAX_CONFIG,
      tipCents: 0,
    });
    const finalTaxSnapshot = buildFinalTaxSnapshot({
      taxConfig: DISABLED_TAX_CONFIG,
      totals,
      capturedAt,
      currency: 'CAD',
    });

    await db.insert(schema.salonSchema).values({
      id: SALON_ID,
      name: 'Export Salon',
      slug: 'export-salon-d6-1',
    });
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_export_d6_1',
      salonId: SALON_ID,
      clientPhone: '4165550199',
      clientName: 'Export Client',
      startTime: capturedAt,
      endTime: new Date(capturedAt.getTime() + 3_600_000),
      status: 'completed',
      completedAt: capturedAt,
      totalPrice: 10_000,
      totalDurationMinutes: 60,
      invoiceCurrency: 'CAD',
      finalPriceCents: 10_000,
      finalSubtotalCents: 10_000,
      finalDiscountCents: 0,
      taxAmountCents: 0,
      taxableSubtotalCents: 0,
      finalTaxSnapshot,
      amountPaidCents: 7500,
      paymentStatus: 'paid',
    });
    await db.insert(schema.appointmentDepositSchema).values({
      id: 'dep_export_d6_1',
      salonId: SALON_ID,
      appointmentId: 'appt_export_d6_1',
      amountCents: 2500,
      currency: 'cad',
      status: 'refunded',
      stripeAccountId: 'acct_export_d6_1',
      stripePaymentIntentId: 'pi_export_d6_1',
      stripeRefundId: 're_export_d6_1',
      refundStatus: 'pending',
      refundAmountCents: 2500,
      refundRequestedAt: capturedAt,
      refundStatusChangedAt: capturedAt,
      refundTrigger: 'owner',
    });
    await db.insert(schema.appointmentPaymentSchema).values({
      id: 'pay_export_d6_1',
      salonId: SALON_ID,
      appointmentId: 'appt_export_d6_1',
      amountCents: 7500,
      idempotencyKey: 'export-payment-key',
      method: 'cash',
      recordedByType: 'admin',
      recordedById: 'admin_export',
    });
    await db.insert(schema.appointmentFinalItemSchema).values({
      id: 'item_export_d6_1',
      salonId: SALON_ID,
      appointmentId: 'appt_export_d6_1',
      kind: 'custom',
      name: 'Final service',
      quantity: 1,
      unitPriceCents: 10_000,
      lineTotalCents: 10_000,
      taxable: false,
    });
    await db.insert(schema.appointmentAuditLogSchema).values({
      id: 'audit_export_d6_1',
      salonId: SALON_ID,
      appointmentId: 'appt_export_d6_1',
      action: 'deposit_refund_requested',
      performedBy: 'admin_export',
      performedByRole: 'admin',
      newValue: { refundStatus: 'pending' },
    });

    const response = await GET(
      new Request(`http://localhost/api/super-admin/organizations/${SALON_ID}/export`),
      { params: Promise.resolve({ id: SALON_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.appointments[0]).toMatchObject({
      id: 'appt_export_d6_1',
      invoiceCurrency: 'CAD',
      finalTaxSnapshot: {
        kind: 'final_actual',
        classification: 'actual',
        currency: 'CAD',
      },
      amountPaidCents: 7500,
    });
    expect(body.appointmentDeposits[0]).toMatchObject({
      id: 'dep_export_d6_1',
      amountCents: 2500,
      refundStatus: 'pending',
    });
    expect(body.appointmentPayments[0]).toMatchObject({
      id: 'pay_export_d6_1',
      amountCents: 7500,
      idempotencyKey: 'export-payment-key',
    });
    expect(body.appointmentFinalItems[0]).toMatchObject({
      id: 'item_export_d6_1',
      lineTotalCents: 10_000,
    });
    expect(body.appointmentAuditLog[0]).toMatchObject({
      id: 'audit_export_d6_1',
      action: 'deposit_refund_requested',
    });
  });
});
