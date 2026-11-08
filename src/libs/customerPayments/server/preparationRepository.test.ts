import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { calculatePaymentSnapshot } from '../money';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository, customerPaymentFingerprint } from './preparationRepository';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createCustomerPaymentPreparationRepository>;
let index = 0;
const settings = { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true };
const snapshot = calculatePaymentSnapshot({ currency: 'cad', collection: 'full', servicesCents: 10000, taxCents: 1300, tipCents: 2000, discountCents: 0 });

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  // Exercise the real migration journal, including 0115, only in memory.
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  repository = createCustomerPaymentPreparationRepository(database);
}, 60000);

afterAll(async () => {
  await client?.close();
});

async function fixture() {
  index += 1;
  const salonId = `prep_salon_${index}`;
  const appointmentId = `prep_appointment_${index}`;
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Preparation fixture' });
  await database.insert(schema.technicianSchema).values({ id: `tech_${index}`, salonId, name: 'Fixture tech' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId: `tech_${index}`, clientPhone: '4165550111', clientName: 'Synthetic customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const policyInput = { salonId, actorId: 'owner', expectedRevision: 0, requestId: randomUUID(), settings };
  const quoteInput = { salonId, appointmentId, requestId: randomUUID(), requestFingerprint: customerPaymentFingerprint({ tipCents: 2000 }) };
  const expiresAt = new Date(Date.now() + 600000);
  const build = vi.fn(async () => ({ snapshot, stripeAccountId: 'acct_test1', expiresAt, context: { appointmentRevision: '1', taxRevision: '1' } }));
  return { salonId, appointmentId, policyInput, quoteInput, build };
}

describe('actual migration and typed preparation repository', () => {
  it('defaults disabled, saves CAS and returns durable original policy replay', async () => {
    const f = await fixture();

    expect(await repository.readCustomerPaymentSettingsDraft(f.salonId)).toEqual({ settings: DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, revision: 0, testOnly: true, collectionEnabled: false });

    const first = await repository.saveCustomerPaymentSettingsDraft(f.policyInput);
    await repository.saveCustomerPaymentSettingsDraft({ ...f.policyInput, requestId: randomUUID(), expectedRevision: 1, settings: { ...settings, enabled: false } });

    expect(await repository.saveCustomerPaymentSettingsDraft(f.policyInput)).toEqual(first);
    await expect(repository.saveCustomerPaymentSettingsDraft({ ...f.policyInput, settings: { ...settings, platformFeeCents: 200 } })).rejects.toThrow('REPLAY_CONFLICT');
    await expect(repository.saveCustomerPaymentSettingsDraft({ ...f.policyInput, requestId: randomUUID() })).rejects.toThrow('REVISION_CONFLICT');
  });

  it('serializes competing policy CAS revisions', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([repository.saveCustomerPaymentSettingsDraft(f.policyInput), repository.saveCustomerPaymentSettingsDraft({ ...f.policyInput, requestId: randomUUID() })]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await repository.readCustomerPaymentSettingsDraft(f.salonId)).revision).toBe(1);
  });

  it('locks before authoritative loading and revalidates every same-key quote replay', async () => {
    const f = await fixture();

    await expect(repository.prepareCustomerPaymentQuote(f.quoteInput, f.build)).rejects.toThrow('DRAFT_DISABLED');

    await repository.saveCustomerPaymentSettingsDraft(f.policyInput);
    const first = await repository.prepareCustomerPaymentQuote(f.quoteInput, f.build);
    const replay = await repository.prepareCustomerPaymentQuote(f.quoteInput, f.build);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({ executable: false, mode: 'test', policyRevision: 1, snapshot });
    expect(f.build).toHaveBeenCalledTimes(2);
    expect(f.build.mock.calls[1]?.length).toBe(4);
    await expect(repository.prepareCustomerPaymentQuote(f.quoteInput, async () => {
      throw new Error('CAPABILITY_REVOKED');
    })).rejects.toThrow('CAPABILITY_REVOKED');
    await expect(repository.prepareCustomerPaymentQuote({ ...f.quoteInput, requestFingerprint: customerPaymentFingerprint({ tipCents: 0 }) }, f.build)).rejects.toThrow('REPLAY_CONFLICT');
    await expect(repository.prepareCustomerPaymentQuote(f.quoteInput, async () => ({ ...await f.build(), context: { appointmentRevision: '2' } }))).rejects.toThrow('QUOTE_STALE');
  });

  it('rejects tenant mismatch, noncanonical quotes, expiry and policy changes', async () => {
    const f = await fixture();
    await repository.saveCustomerPaymentSettingsDraft(f.policyInput);

    await expect(repository.prepareCustomerPaymentQuote({ ...f.quoteInput, salonId: 'foreign' }, f.build)).rejects.toThrow('APPOINTMENT_NOT_FOUND');
    await expect(repository.prepareCustomerPaymentQuote(f.quoteInput, async () => ({ ...await f.build(), snapshot: { ...snapshot, chargeCents: 1 } }))).rejects.toThrow('SNAPSHOT_MISMATCH');
    await expect(repository.prepareCustomerPaymentQuote(f.quoteInput, async () => ({ ...await f.build(), expiresAt: new Date(0) }))).rejects.toThrow('QUOTE_STALE');

    await repository.prepareCustomerPaymentQuote(f.quoteInput, f.build);
    await repository.saveCustomerPaymentSettingsDraft({ ...f.policyInput, requestId: randomUUID(), expectedRevision: 1, settings: { ...settings, cancellationPolicy: 'Changed policy' } });

    await expect(repository.prepareCustomerPaymentQuote(f.quoteInput, f.build)).rejects.toThrow('QUOTE_STALE');
  });

  it('enforces test-only constraints, immutable evidence and tenant FKs in SQL', async () => {
    const f = await fixture();
    await repository.saveCustomerPaymentSettingsDraft(f.policyInput);
    const quote = await repository.prepareCustomerPaymentQuote(f.quoteInput, f.build);

    await expect(client.query('UPDATE customer_payment_policy SET mode=\'live\' WHERE salon_id=$1', [f.salonId])).rejects.toThrow();
    await expect(client.query('UPDATE customer_payment_policy SET collection_enabled=true WHERE salon_id=$1', [f.salonId])).rejects.toThrow();
    await expect(client.query('UPDATE customer_payment_policy SET settings=\'{}\'::jsonb WHERE salon_id=$1', [f.salonId])).rejects.toThrow();
    await expect(client.query('UPDATE customer_payment_prepared_quote SET fingerprint=repeat(\'a\',64) WHERE id=$1', [quote.id])).rejects.toThrow('immutable');
    await expect(client.query('UPDATE customer_payment_policy_receipt SET fingerprint=repeat(\'a\',64) WHERE salon_id=$1', [f.salonId])).rejects.toThrow('immutable');
    await expect(client.query(`INSERT INTO customer_payment_prepared_quote SELECT 'foreign', 'foreign', appointment_id, request_id, request_fingerprint, fingerprint, policy_revision, stripe_account_id, mode, executable, snapshot, context, expires_at, created_at FROM customer_payment_prepared_quote WHERE id=$1`, [quote.id])).rejects.toThrow();
    await expect(client.query(`INSERT INTO customer_payment_prepared_quote SELECT 'live', salon_id, appointment_id, 'live', request_fingerprint, fingerprint, policy_revision, stripe_account_id, 'live', false, snapshot, context, expires_at, created_at FROM customer_payment_prepared_quote WHERE id=$1`, [quote.id])).rejects.toThrow();

    const untouched = await client.query('SELECT amount_paid_cents,tip_cents FROM appointment WHERE id=$1', [f.appointmentId]);

    expect(untouched.rows[0]).toMatchObject({ amount_paid_cents: null, tip_cents: 0 });
  });

  it('caps new drafts under appointment lock but still revalidates replay at the cap', async () => {
    const f = await fixture();
    await repository.saveCustomerPaymentSettingsDraft(f.policyInput);
    const first = await repository.prepareCustomerPaymentQuote(f.quoteInput, f.build);
    await client.query(`INSERT INTO customer_payment_prepared_quote
      SELECT id || '_' || n, salon_id, appointment_id, request_id || '_' || n,
      request_fingerprint, fingerprint, policy_revision, stripe_account_id, mode,
      executable, snapshot, context, expires_at, created_at
      FROM customer_payment_prepared_quote CROSS JOIN generate_series(1,49) AS n WHERE id=$1`, [first.id]);

    await expect(repository.prepareCustomerPaymentQuote({ ...f.quoteInput, requestId: randomUUID() }, f.build)).rejects.toThrow('QUOTE_LIMIT_REACHED');
    expect(await repository.prepareCustomerPaymentQuote(f.quoteInput, f.build)).toEqual(first);
  });

  it('hashes canonical object order and refuses ambiguous JSON values', () => {
    expect(customerPaymentFingerprint({ a: 1, b: 2 })).toBe(customerPaymentFingerprint({ b: 2, a: 1 }));
    expect(() => customerPaymentFingerprint({ a: undefined })).toThrow('INVALID_FINGERPRINT');
    expect(() => customerPaymentFingerprint({ a: Number.NaN })).toThrow('INVALID_FINGERPRINT');
  });
});
