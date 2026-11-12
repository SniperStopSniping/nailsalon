import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createCustomerPaymentPreparationRepository>;
let index = 0;
const settings = { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true };

beforeAll(async () => {
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  client = new PGlite();
  database = drizzle(client, { schema });
  // No application connection: exercise the complete journal in this fixture only.
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  repository = createCustomerPaymentPreparationRepository(database);
}, 60000);

afterAll(async () => {
  await client?.close();
  vi.unstubAllEnvs();
});

async function fixture() {
  index += 1;
  const salonId = `quote_salon_${index}`;
  const appointmentId = `quote_appointment_${index}`;
  const tokenId = `quote_capability_${index}`;
  const bindingId = `quote_binding_${index}`;
  const serviceId = `quote_service_${index}`;
  const serviceSnapshotId = `quote_service_snapshot_${index}`;
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const future = (offset: number) => new Date(now.getTime() + offset);
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Synthetic salon', status: 'active', publicationStatus: 'published' });
  await database.insert(schema.technicianSchema).values({ id: `quote_tech_${index}`, salonId, name: 'Synthetic technician' });
  await database.insert(schema.serviceSchema).values({ id: serviceId, salonId, name: 'Fixed service', price: 10000, durationMinutes: 60, category: 'manicure' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId: `quote_tech_${index}`, clientPhone: '4165550111', clientName: 'PRIVATE_NAME', notes: 'PRIVATE_NOTE', startTime: future(86400000), endTime: future(90000000), totalPrice: 10000, basePriceCents: 10000, addOnsPriceCents: 0, subtotalBeforeDiscountCents: 10000, totalDurationMinutes: 60, status: 'confirmed', invoiceCurrency: 'CAD', bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals: { finalPriceCents: 10000, taxableSubtotalCents: 0, taxAmountCents: 0, taxApplied: false }, currency: 'CAD', capturedAt: now }) });
  await database.insert(schema.appointmentServicesSchema).values({ id: serviceSnapshotId, appointmentId, serviceId, priceAtBooking: 10000, durationAtBooking: 60 });
  await database.insert(schema.salonStripeAccountSchema).values({ id: bindingId, salonId, stripeAccountId: `acct_fixture${index}`, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: now });
  await database.insert(schema.appointmentAccessTokenSchema).values({ id: tokenId, salonId, appointmentId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: future(3600000) });
  const policyInput = { salonId, actorId: 'synthetic_owner', expectedRevision: 0, requestId: randomUUID(), settings };
  await repository.saveCustomerPaymentSettingsDraft(policyInput);
  const request = { requestId: randomUUID(), tipCents: 2000 };
  const prepare = () => prepareCustomerPaymentQuoteForToken(database, token, request);
  return { salonId, appointmentId, tokenId, bindingId, serviceSnapshotId, token, policyInput, request, prepare };
}

describe('migration-backed actual appointment quote preparation', () => {
  it('stores authoritative immutable evidence, replays exactly and leaves financial state untouched', async () => {
    const f = await fixture();
    const before = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));
    const first = await f.prepare();

    expect(first).toMatchObject({ salonId: f.salonId, appointmentId: f.appointmentId, executable: false, mode: 'test', policyRevision: 1, snapshot: { chargeCents: 12000, taxCents: 0, tipCents: 2000, applicationFeeCents: 100, customerPlatformFeeCents: 0 } });
    expect(await f.prepare()).toEqual(first);
    expect(JSON.stringify(first.context)).not.toMatch(/PRIVATE_|4165550111/);
    expect(JSON.stringify(first.context)).not.toContain(f.token);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId))).toEqual(before);
    expect(await database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, f.appointmentId))).toEqual([]);
    expect(await database.select().from(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.appointmentId, f.appointmentId))).toEqual([]);
    await expect(prepareCustomerPaymentQuoteForToken(database, f.token, { ...f.request, tipCents: 0 })).rejects.toThrow('REPLAY_CONFLICT');
    await expect(client.query('UPDATE customer_payment_prepared_quote SET executable=true WHERE id=$1', [first.id])).rejects.toThrow();
  });

  it.each(['revoked', 'expired'])('rejects %s capability before creation and on durable replay', async (kind) => {
    const f = await fixture();
    await f.prepare();
    const patch = kind === 'revoked' ? { revokedAt: new Date() } : { expiresAt: new Date(0) };
    await database.update(schema.appointmentAccessTokenSchema).set(patch).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));

    await expect(f.prepare()).rejects.toThrow('ACCESS_REQUIRED');
    await expect(prepareCustomerPaymentQuoteForToken(database, f.token, { ...f.request, requestId: randomUUID() })).rejects.toThrow('ACCESS_REQUIRED');
  });

  it.each(['revoked', 'expired'])('rechecks %s access between lookup and transaction', async (kind) => {
    const f = await fixture();
    const racingDatabase = {
      select: database.select.bind(database),
      transaction: async (callback: Parameters<typeof database.transaction>[0]) => {
        const patch = kind === 'revoked' ? { revokedAt: new Date() } : { expiresAt: new Date(0) };
        await database.update(schema.appointmentAccessTokenSchema).set(patch).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
        return database.transaction(callback);
      },
    };

    await expect(prepareCustomerPaymentQuoteForToken(racingDatabase as never, f.token, f.request)).rejects.toThrow('ACCESS_REQUIRED');

    const rows = await client.query('SELECT id FROM customer_payment_prepared_quote WHERE appointment_id=$1', [f.appointmentId]);

    expect(rows.rows).toEqual([]);
  });

  it('refuses a capability whose salon does not own the appointment', async () => {
    const f = await fixture();
    const other = await fixture();
    await database.update(schema.appointmentAccessTokenSchema).set({ salonId: other.salonId }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));

    await expect(f.prepare()).rejects.toThrow('APPOINTMENT_NOT_FOUND');
    await expect(prepareCustomerPaymentQuoteForToken(database, randomBytes(32).toString('base64url'), f.request)).rejects.toThrow('ACCESS_REQUIRED');
  });

  it.each(['live', 'revoked', 'not_ready'])('refuses %s binding on replay', async (kind) => {
    const f = await fixture();
    await f.prepare();
    const patch = kind === 'live' ? { livemode: true } : kind === 'revoked' ? { revokedAt: new Date(), revocationCause: 'revoked_local' as const } : { chargesEnabled: false };
    await database.update(schema.salonStripeAccountSchema).set(patch).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));

    await expect(f.prepare()).rejects.toThrow(/ACCOUNT_UNAVAILABLE|BINDING_UNAVAILABLE/);
  });

  it('invalidates durable replay after a policy revision or source time changes', async () => {
    const f = await fixture();
    await f.prepare();
    await repository.saveCustomerPaymentSettingsDraft({ ...f.policyInput, expectedRevision: 1, requestId: randomUUID(), settings: { ...settings, cancellationPolicy: 'Changed terms' } });

    await expect(f.prepare()).rejects.toThrow('QUOTE_STALE');

    const g = await fixture();
    await g.prepare();
    await database.update(schema.appointmentSchema).set({ startTime: new Date(Date.now() + 86401000) }).where(eq(schema.appointmentSchema.id, g.appointmentId));

    await expect(g.prepare()).rejects.toThrow('QUOTE_STALE');
  });

  it('refuses voided tender, existing deposit and manual service history without mutation', async () => {
    const f = await fixture();
    await database.insert(schema.appointmentPaymentSchema).values({ id: 'voided_history', salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 100, recordedByType: 'system', voidedAt: new Date() });

    await expect(f.prepare()).rejects.toThrow('EXISTING_MONEY_UNSUPPORTED');

    const g = await fixture();
    await database.insert(schema.appointmentDepositSchema).values({ id: 'deposit_history', salonId: g.salonId, appointmentId: g.appointmentId, amountCents: 100, status: 'checkout_created', stripeAccountId: `acct_fixture${index}` });

    await expect(g.prepare()).rejects.toThrow('EXISTING_MONEY_UNSUPPORTED');

    const h = await fixture();
    await database.update(schema.appointmentServicesSchema).set({ priceDisplayTextSnapshot: 'Starting at $100' }).where(eq(schema.appointmentServicesSchema.id, h.serviceSnapshotId));

    await expect(h.prepare()).rejects.toThrow('SERVICE_UNSUPPORTED');
  });

  it('gates before any database operation even if called outside the route', async () => {
    const select = vi.fn();
    const transaction = vi.fn();
    vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false');
    try {
      await expect(prepareCustomerPaymentQuoteForToken({ select, transaction } as never, 'a'.repeat(43), { requestId: randomUUID(), tipCents: 0 })).rejects.toThrow('DISABLED');
      expect(select).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
    }
  });

  it('does not hide historical wrong-tenant money behind a salon filter', async () => {
    const f = await fixture();
    const other = await fixture();
    // Reproduce a pre-0068 anomaly: that migration adds the FK NOT VALID.
    // Only this isolated disposable fixture loses the constraint; no app DB exists.
    await client.exec('ALTER TABLE appointment_payment DROP CONSTRAINT appointment_payment_appointment_tenant_fk');
    await database.insert(schema.appointmentPaymentSchema).values({ id: 'legacy_wrong_tenant', salonId: other.salonId, appointmentId: f.appointmentId, amountCents: 100, recordedByType: 'system' });

    await expect(f.prepare()).rejects.toThrow('EXISTING_MONEY_UNSUPPORTED');
  });
});
