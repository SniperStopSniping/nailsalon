import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { buildBookingTaxSnapshot, buildFinalTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { workspaceInvoiceSchema } from './workspaceContract';
import { prepareWorkspaceInvoice, readWorkspaceInvoice } from './workspaceInvoice';
import { createPaymentWorkspaceRepository } from './workspaceRepository';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

afterAll(async () => {
  await client?.close();
});

async function fixture(inclusive = false) {
  const id = randomUUID();
  const scope = { salonId: `invoice_salon_${id}`, appointmentId: `invoice_appointment_${id}` };
  const config = { ...DISABLED_TAX_CONFIG, enabled: true, name: 'HST', rateBps: 1300, pricesIncludeTax: inclusive, taxServicesByDefault: true };
  const totals = computeCheckoutTotals({ items: [{ lineTotalCents: 10000, taxable: true }], taxConfig: config, tipCents: 1000 });
  const bookingTaxSnapshot = buildBookingTaxSnapshot({ taxConfig: config, totals, currency: 'CAD', capturedAt: new Date() });
  await database.insert(schema.salonSchema).values({ id: scope.salonId, slug: scope.salonId, name: 'Invoice fixture' });
  await database.insert(schema.technicianSchema).values({ id, salonId: scope.salonId, name: 'Fixture technician' });
  await database.insert(schema.serviceSchema).values({ id, salonId: scope.salonId, name: 'Service', price: 10000, durationMinutes: 60, category: 'manicure' });
  await database.insert(schema.appointmentSchema).values({ id: scope.appointmentId, salonId: scope.salonId, technicianId: id, clientPhone: '4165550111', clientName: 'PRIVATE_CUSTOMER', notes: 'PRIVATE_NOTE', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, subtotalBeforeDiscountCents: 10000, totalDurationMinutes: 60, status: 'confirmed', invoiceCurrency: 'CAD', bookingTaxSnapshot, tipCents: 1000 });
  await database.insert(schema.appointmentServicesSchema).values({ id, appointmentId: scope.appointmentId, serviceId: id, nameSnapshot: 'Gel manicure', priceAtBooking: 10000, durationAtBooking: 60 });
  const actor = { ...scope, id: 'owner', role: 'owner' as const, impersonating: false, canEditItems: true, canRecordPayment: true };
  const read = () => database.transaction(async (tx) => {
    const [appointment] = await tx.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, scope.appointmentId)).for('update');
    return readWorkspaceInvoice(tx, appointment!);
  });
  const deposit = (amountCents = 2000) => database.insert(schema.appointmentDepositSchema).values({ id, ...scope, stripeAccountId: 'acct_fixture', stripePaymentIntentId: `pi_${id.replaceAll('-', '')}`, status: 'paid', amountCents, currency: 'cad', collectedAt: new Date() });
  return { id, scope, actor, config, totals, read, deposit };
}

describe('workspace reads the real checkout invoice and tender sources', () => {
  it.each([false, true])('preserves frozen tax in inclusive=%s mode and excludes private appointment data', async (inclusive) => {
    const f = await fixture(inclusive);
    const material = await f.read();

    expect(material.bill).toMatchObject({ serviceCents: f.totals.finalPriceCents, taxCents: f.totals.taxAmountCents, tipCents: 1000 });
    expect(material.invoice.items).toMatchObject([{ name: 'Gel manicure', lineTotalCents: 10000 }]);
    expect(material.initialPayments).toEqual([]);
    expect(JSON.stringify(material)).not.toMatch(/PRIVATE_|4165550111/);
    expect((await f.read()).billSourceHash).toBe(material.billSourceHash);
    expect(workspaceInvoiceSchema.safeParse({ ...material.invoice, taxSnapshot: null }).success).toBe(false);
  });

  it('initializes the durable workspace with deposit credit and manual tender exactly once', async () => {
    const f = await fixture();
    await f.deposit();
    await database.insert(schema.appointmentPaymentSchema).values({ id: randomUUID(), ...f.scope, amountCents: 9500, method: 'cash', recordedByType: 'admin', recordedById: 'owner' });
    await database.update(schema.appointmentSchema).set({ amountPaidCents: 9500 }).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));
    const repository = createPaymentWorkspaceRepository(database);
    const result = await repository.initialize(f.actor, randomUUID(), prepareWorkspaceInvoice);

    expect(result.state.payments).toMatchObject([
      { kind: 'deposit', principalCents: 2000, tipCents: 0 },
      { kind: 'manual', principalCents: 9300, tipCents: 200 },
    ]);
    expect(result.state.bill.serviceCents + result.state.bill.taxCents + result.state.bill.tipCents).toBe(12300);
    expect(result.state.invoice?.items[0]?.name).toBe('Gel manicure');

    const [audit] = await database.select().from(schema.customerPaymentWorkspaceAuditSchema).where(eq(schema.customerPaymentWorkspaceAuditSchema.appointmentId, f.scope.appointmentId));

    expect(audit?.state.invoice).toEqual(result.state.invoice);
    await expect(repository.reviseBill(f.actor, { requestId: randomUUID(), expectedRevision: 0, reason: 'Changed service', changeFingerprint: 'a'.repeat(64) }, async () => ({ bill: { ...result.state.bill, serviceCents: 9000 }, billSourceHash: 'a'.repeat(64) }))).rejects.toThrow('READABLE_INVOICE_REQUIRED');
    expect((await repository.read(f.actor))?.revision).toBe(0);
  });

  it('holds deposit refunds and invalidated credit instead of treating them as zero paid', async () => {
    const f = await fixture();
    await f.deposit();
    const before = await f.read();
    await database.update(schema.appointmentDepositSchema).set({ refundStatus: 'requested', refundStatusChangedAt: new Date(), refundAmountCents: 2000, refundRequestedAt: new Date() }).where(eq(schema.appointmentDepositSchema.id, f.id));

    expect(before.initialPayments).toMatchObject([{ kind: 'deposit', principalCents: 2000 }]);
    await expect(f.read()).rejects.toThrow('DEPOSIT_REFUND_IN_FLIGHT');
  });

  it('rejects a changed item total, unknown historical tax and a mismatched tender cache', async () => {
    const f = await fixture();
    await database.update(schema.appointmentServicesSchema).set({ priceAtBooking: 9999 }).where(eq(schema.appointmentServicesSchema.id, f.id));

    await expect(f.read()).rejects.toThrow('INVOICE_TOTAL_MISMATCH');

    await database.update(schema.appointmentServicesSchema).set({ priceAtBooking: 10000 }).where(eq(schema.appointmentServicesSchema.id, f.id));
    await database.update(schema.appointmentSchema).set({ amountPaidCents: 1000 }).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));

    await expect(f.read()).rejects.toThrow('LEDGER_RECONCILIATION_REQUIRED');

    await database.update(schema.appointmentSchema).set({ amountPaidCents: 0, invoiceCurrency: null, bookingTaxSnapshot: null }).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));

    await expect(f.read()).rejects.toThrow('FROZEN_INVOICE_REQUIRED');
  });

  it('retains readable final items and their frozen actual tax instead of current catalog prices', async () => {
    const f = await fixture();
    const finalTaxSnapshot = buildFinalTaxSnapshot({ taxConfig: f.config, totals: f.totals, currency: 'CAD', capturedAt: new Date(), taxExempt: false, taxExemptReason: null });
    await database.update(schema.appointmentSchema).set({ status: 'completed', completedAt: new Date(finalTaxSnapshot.capturedAt), finalPriceCents: f.totals.finalPriceCents, finalSubtotalCents: 10000, finalDiscountCents: 0, finalTaxSnapshot, taxableSubtotalCents: f.totals.taxableSubtotalCents, taxAmountCents: f.totals.taxAmountCents, taxExempt: false, taxExemptReason: null, amountPaidCents: 0 }).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));
    await database.insert(schema.appointmentFinalItemSchema).values({ id: randomUUID(), ...f.scope, kind: 'service', name: 'Performed gel manicure', quantity: 1, unitPriceCents: 10000, lineTotalCents: 10000 });
    await database.update(schema.serviceSchema).set({ price: 99000 }).where(eq(schema.serviceSchema.id, f.id));
    const material = await f.read();

    expect(material.invoice.items[0]?.name).toBe('Performed gel manicure');
    expect(material.invoice.taxSnapshot.kind).toBe('final_actual');
    expect(material.bill.serviceCents).toBe(10000);
  });

  it('detects legacy tender changes in the source hash and refuses existing excess deposit credit', async () => {
    const f = await fixture();
    const before = await f.read();
    await database.insert(schema.appointmentPaymentSchema).values({ id: randomUUID(), ...f.scope, amountCents: 1000, method: 'cash', recordedByType: 'admin', recordedById: 'owner' });
    await database.update(schema.appointmentSchema).set({ amountPaidCents: 1000 }).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));

    expect((await f.read()).billSourceHash).not.toBe(before.billSourceHash);

    await f.deposit(12000);

    await expect(f.read()).rejects.toThrow('EXISTING_OVERPAYMENT_REVIEW_REQUIRED');
  });
});
