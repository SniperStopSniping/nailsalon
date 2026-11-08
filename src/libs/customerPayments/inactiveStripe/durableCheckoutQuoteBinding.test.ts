import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { createCustomerPaymentPreparationRepository } from '../server/preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from '../server/prepareQuoteForToken';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { buildInactiveStripeCheckoutOperation } from './checkoutContract';
import { assertDurableCheckoutQuoteBinding } from './durableCheckoutQuoteBinding';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(async () => client?.close());

async function fixture() {
  const suffix = randomUUID().replaceAll('-', '');
  const salonId = `binding_salon_${suffix}`;
  const appointmentId = `binding_appt_${suffix}`;
  const tokenId = `binding_token_${suffix}`;
  const bindingId = `binding_account_${suffix}`;
  const itemId = `binding_item_${suffix}`;
  const technicianId = `binding_tech_${suffix}`;
  const serviceId = `binding_service_${suffix}`;
  const accountId = `acct_${suffix}`;
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const future = (offset: number) => new Date(now.getTime() + offset);
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Closed quote fixture', status: 'active', publicationStatus: 'published' });
  await database.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Fixture technician' });
  await database.insert(schema.serviceSchema).values({ id: serviceId, salonId, name: 'Fixture service', price: 10000, durationMinutes: 60, category: 'manicure' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId, clientPhone: '4165550111', clientName: 'Private fixture name', startTime: future(86400000), endTime: future(90000000), totalPrice: 10000, basePriceCents: 10000, addOnsPriceCents: 0, subtotalBeforeDiscountCents: 10000, totalDurationMinutes: 60, status: 'confirmed', invoiceCurrency: 'CAD', bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals: { finalPriceCents: 10000, taxableSubtotalCents: 0, taxAmountCents: 0, taxApplied: false }, currency: 'CAD', capturedAt: now }) });
  await database.insert(schema.appointmentServicesSchema).values({ id: itemId, appointmentId, serviceId, priceAtBooking: 10000, durationAtBooking: 60 });
  await database.insert(schema.salonStripeAccountSchema).values({ id: bindingId, salonId, stripeAccountId: accountId, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: now });
  await database.insert(schema.appointmentAccessTokenSchema).values({ id: tokenId, salonId, appointmentId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: future(3600000) });
  const repository = createCustomerPaymentPreparationRepository(database);
  const policyInput = { salonId, actorId: 'closed_fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } };
  await repository.saveCustomerPaymentSettingsDraft(policyInput);
  const quote = await prepareCustomerPaymentQuoteForToken(database, token, { requestId: randomUUID(), tipCents: 2000 });
  const s = quote.snapshot;
  const operation = buildInactiveStripeCheckoutOperation({
    operationId: randomUUID(),
    requestId: randomUUID(),
    salonId,
    appointmentId,
    quoteId: quote.id,
    contextHash: quote.fingerprint,
    createdAt: quote.createdAt.getTime(),
    quoteExpiresAt: quote.expiresAt.getTime(),
    sessionExpiresAt: Math.ceil(quote.expiresAt.getTime() / 1000) * 1000 + 1800000,
    successUrl: 'https://closed.invalid/success',
    cancelUrl: 'https://closed.invalid/cancel',
    quote: { currency: 'cad', collection: 'full', servicesCents: s.servicesCents, discountCents: s.discountCents, taxCents: s.taxCents, tipCents: s.tipCents, feePolicy: { payer: 'salon', feeCents: s.configuredFeeCents, taxTreatment: 'not_collected_in_test_mode' } },
  }, { platformAccountId: 'acct_closedPlatform', connectedAccountId: accountId, mode: 'test', returnOrigin: 'https://closed.invalid' });
  const check = (value = operation, clock = new Date()) => database.transaction(tx => assertDurableCheckoutQuoteBinding(tx as never, value, clock));
  return { salonId, appointmentId, tokenId, bindingId, itemId, quote, operation, check, repository, policyInput };
}

describe('closed checkout prepared quote binding', () => {
  it('revalidates exact prepared material repeatedly without changing appointment or money', async () => {
    const f = await fixture();
    const before = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));

    await f.check();
    await f.check();

    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId))).toEqual(before);
    expect((await client.query('SELECT id FROM appointment_payment WHERE appointment_id=$1', [f.appointmentId])).rows).toEqual([]);
    expect((await client.query('SELECT id FROM appointment_deposit WHERE appointment_id=$1', [f.appointmentId])).rows).toEqual([]);
  });

  it('compares the complete snapshot even when caller changes preserve the total', async () => {
    const f = await fixture();
    const changed = buildInactiveStripeCheckoutOperation({ ...f.operation.material, quote: { ...f.operation.material.quote, servicesCents: 9999, taxCents: 1 } }, f.operation.binding);

    expect(changed.snapshot.chargeCents).toBe(f.operation.snapshot.chargeCents);
    await expect(f.check(changed)).rejects.toThrow('PREPARED_QUOTE_MISMATCH');
  });

  it.each(['context', 'account', 'expiry', 'creation', 'deposit'] as const)('rejects changed %s ownership material', async (kind) => {
    const f = await fixture();
    const material = structuredClone(f.operation.material);
    const binding = { ...f.operation.binding };
    if (kind === 'context') {
      material.contextHash = 'f'.repeat(64);
    } else if (kind === 'account') {
      binding.connectedAccountId = 'acct_unowned';
    } else if (kind === 'expiry') {
      material.quoteExpiresAt -= 1;
    } else if (kind === 'creation') {
      material.createdAt += 1;
    } else {
      material.quote.collection = 'deposit';
      material.quote.depositCents = 10000;
    }

    await expect(f.check(buildInactiveStripeCheckoutOperation(material, binding))).rejects.toThrow('PREPARED_QUOTE_MISMATCH');
  });

  it.each(['capability', 'account', 'policy', 'salon', 'appointment', 'item', 'payment', 'deposit'] as const)('rejects current %s source changes', async (kind) => {
    const f = await fixture();
    if (kind === 'capability') {
      await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    } else if (kind === 'account') {
      await database.update(schema.salonStripeAccountSchema).set({ chargesEnabled: false }).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));
    } else if (kind === 'policy') {
      await f.repository.saveCustomerPaymentSettingsDraft({ ...f.policyInput, requestId: randomUUID(), expectedRevision: 1 });
    } else if (kind === 'salon') {
      await database.update(schema.salonSchema).set({ publicationStatus: 'draft' }).where(eq(schema.salonSchema.id, f.salonId));
    } else if (kind === 'appointment') {
      await database.update(schema.appointmentSchema).set({ startTime: new Date(Date.now() + 86401000) }).where(eq(schema.appointmentSchema.id, f.appointmentId));
    } else if (kind === 'item') {
      await database.update(schema.appointmentServicesSchema).set({ durationAtBooking: 61 }).where(eq(schema.appointmentServicesSchema.id, f.itemId));
    } else if (kind === 'payment') {
      await database.insert(schema.appointmentPaymentSchema).values({ id: randomUUID(), salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 1, recordedByType: 'system', voidedAt: new Date() });
    } else {
      await database.insert(schema.appointmentDepositSchema).values({ id: randomUUID(), salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 100, status: 'checkout_created', stripeAccountId: f.operation.binding.connectedAccountId });
    }

    await expect(f.check()).rejects.toThrow(/PREPARED_QUOTE_|CUSTOMER_PAYMENT_QUOTE_/);
  });

  it('uses supplied database time rather than a skewed application clock and rejects expiry equality', async () => {
    const f = await fixture();
    const clock = new Date();
    vi.spyOn(Date, 'now').mockReturnValue(f.quote.expiresAt.getTime() + 86400000);

    await f.check(f.operation, clock);

    await expect(f.check(f.operation, f.quote.expiresAt)).rejects.toThrow('PREPARED_QUOTE_MISMATCH');
  });

  it('detaches operation and clock before the first awaited source read', async () => {
    const f = await fixture();
    const operation = structuredClone(f.operation);
    const clock = new Date();
    let changed = false;
    await database.transaction(tx => assertDurableCheckoutQuoteBinding(new Proxy(tx, {
      get(target, key, receiver) {
        if (key === 'select') {
          return (...args: unknown[]) => {
            changed = true;
            operation.material.contextHash = 'f'.repeat(64);
            operation.binding.connectedAccountId = 'acct_changed';
            clock.setTime(0);
            return Reflect.apply(target.select, target, args);
          };
        }
        return Reflect.get(target, key, receiver);
      },
    }) as never, operation, clock));

    expect(changed).toBe(true);
    expect(operation.material.contextHash).not.toBe(f.operation.material.contextHash);
  });

  it('rejects a disabled runtime before accessing a transaction', async () => {
    const f = await fixture();
    const select = vi.fn();
    vi.stubEnv('NODE_ENV', 'production');

    await expect(assertDurableCheckoutQuoteBinding({ select } as never, f.operation, new Date())).rejects.toThrow('RUNTIME_DISABLED');
    expect(select).not.toHaveBeenCalled();
  });
});
