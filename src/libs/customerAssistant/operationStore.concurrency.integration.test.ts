/** Real row-lock evidence for the durable store; full creation is tested separately. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import type { CustomerBookingMaterial } from './bookingOperationContracts';

const rawUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
const required = process.env.CUSTOMER_BOOKING_PG_REQUIRED === 'true';
if (!rawUrl && required) {
  throw new Error('Customer booking PostgreSQL tests require an attested disposable target.');
}
const target = rawUrl ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl }) : null;
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

const {
  customerBookingOperationReference,
  linkCustomerBookingOperation,
  lockCustomerBookingOperation,
  prepareCustomerBookingOperation,
  readCustomerBookingOperation,
  recordCustomerBookingFailure,
} = await import('./operationStore.server');

const SECRET = 'synthetic-customer-operation-secret-not-a-provider-key';
const SALON = 'synthetic-customer-operation-primary';
const OTHER = 'synthetic-customer-operation-other';
const CONTACT = { name: 'Synthetic Customer', email: 'customer@example.invalid', phone: '4165550101' };
const NOW = new Date('2026-09-18T12:00:00Z');
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
let executed = 0;

function material(): CustomerBookingMaterial {
  return {
    selection: { baseServiceId: 'synthetic-service', selectedAddOns: [] },
    preference: { date: '2026-09-19', earliest: '12:00', latest: '17:00' },
    startTime: '2026-09-19T17:00:00.000Z',
    technicianSelection: 'any',
    smsConsent: { granted: true, selection: 'default_on', wordingVersion: 'booking-sms-reminders-v1' },
    expectedTotalCents: 5000,
    expectedDiscountType: null,
    expectedBookingFinancialQuote: { currency: 'CAD', totalDueCents: 5000, taxConfigurationIdentity: 'synthetic-tax' },
    expectedDepositFingerprint: 'deposit-v1:none',
    review: {
      status: 'READY',
      fingerprint: 'a'.repeat(64),
      expiresAt: '2026-09-18T12:05:00Z',
      salon: { id: SALON, slug: SALON, name: 'Synthetic Operation Salon' },
      location: null,
      services: [{ id: 'synthetic-service', name: 'Synthetic Service', priceCents: 5000 }],
      addOns: [],
      technician: { kind: 'any_artist' },
      date: '2026-09-19',
      time: '13:00',
      timeZone: 'America/Toronto',
      durationMinutes: 60,
      financial: { subtotalCents: 5000, discountAmountCents: 0, discountLabel: null, taxAmountCents: 0, totalDueCents: 5000, currency: 'CAD' },
      deposit: { status: 'not_required', reason: 'policy_inactive' },
      confirmationMode: 'instant',
      bookingPolicy: { required: false },
      reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true },
    },
  };
}

function prepare(sessionId: string, expectedRevision = 0, value = material()) {
  return prepareCustomerBookingOperation({ salonId: SALON, sessionId, secret: SECRET, contact: CONTACT, material: value, expectedRevision, now: NOW });
}

async function createLinked(reference: ReturnType<typeof customerBookingOperationReference>, contact = CONTACT) {
  return database.transaction(async (tx) => {
    const result = await lockCustomerBookingOperation(tx, { salonId: SALON, secret: SECRET, contact, ...reference, now: NOW });
    if (result.kind === 'replay') {
      return result.operation.appointmentId;
    }
    const id = `synthetic-operation-appointment-${randomUUID()}`;
    await tx.insert(schema.appointmentSchema).values({
      id,
      salonId: SALON,
      salonClientId: 'synthetic-operation-client',
      clientPhone: CONTACT.phone,
      startTime: new Date('2026-09-19T17:00:00Z'),
      endTime: new Date('2026-09-19T18:00:00Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
    });
    await linkCustomerBookingOperation(tx, result.operation, id, NOW);
    return id;
  });
}

(target ? describe : describe.skip)('durable customer booking operation — real PostgreSQL', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Missing attested target');
    }
    pool = new pg.Pool({ connectionString: target.connectionString, max: 8 });
    const client = await pool.connect();
    try {
      await attestDisposableDatabaseSession(client, target, resolveDisposableDatabaseServerExpectation(target));
    } finally {
      client.release();
    }
    database = drizzle(pool, { schema });
    holder.db = database;
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    await database.insert(schema.salonSchema).values([SALON, OTHER].map(id => ({ id, slug: id, name: 'Synthetic Operation Test Salon' }))).onConflictDoNothing();
    await database.insert(schema.salonClientSchema).values({ id: 'synthetic-operation-client', salonId: SALON, phone: CONTACT.phone }).onConflictDoNothing();
  }, 120_000);

  beforeEach(async () => {
    await database.delete(schema.customerBookingOperationSchema).where(inArray(schema.customerBookingOperationSchema.salonId, [SALON, OTHER]));
    await database.delete(schema.appointmentSchema).where(inArray(schema.appointmentSchema.salonId, [SALON, OTHER]));
    executed += 1;
  });

  afterAll(async () => {
    if (database) {
      await database.delete(schema.customerBookingOperationSchema).where(inArray(schema.customerBookingOperationSchema.salonId, [SALON, OTHER]));
      await database.delete(schema.appointmentSchema).where(inArray(schema.appointmentSchema.salonId, [SALON, OTHER]));
      await database.delete(schema.salonClientSchema).where(eq(schema.salonClientSchema.id, 'synthetic-operation-client'));
      await database.delete(schema.salonSchema).where(inArray(schema.salonSchema.id, [SALON, OTHER]));
    }
    await pool?.end();

    expect(executed).toBe(8);

    process.stdout.write(`CUSTOMER_OPERATION_POSTGRES_TESTS_EXECUTED=${executed} CUSTOMER_OPERATION_POSTGRES_TESTS_SKIPPED=0\n`);
  });

  it('concurrent first prepares return one row and the same capability', async () => {
    const sessionId = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => prepare(sessionId)));

    expect(new Set(results.map(row => row.id)).size).toBe(1);
    expect(new Set(results.map(row => customerBookingOperationReference(row, SECRET).capability)).size).toBe(1);
    expect(await database.select().from(schema.customerBookingOperationSchema).where(eq(schema.customerBookingOperationSchema.salonId, SALON))).toHaveLength(1);
  });

  it('pins reminder explicitness and financial/deposit changes in the revision', async () => {
    const session = randomUUID();
    const first = await prepare(session);
    const changed = material();
    changed.smsConsent!.selection = 'explicit_on';
    const second = await prepare(session, 1, changed);

    expect(second.revision).toBe(2);
    expect(second.requestHash).not.toBe(first.requestHash);

    changed.expectedDepositFingerprint = 'deposit-v1:2500';
    changed.expectedBookingFinancialQuote.totalDueCents = 5200;
    const third = await prepare(session, 2, changed);

    expect(third.revision).toBe(3);
    await expect(prepare(session, 1, material())).rejects.toMatchObject({ code: 'revision_changed' });
    expect((await readCustomerBookingOperation({ salonId: SALON, secret: SECRET, capability: customerBookingOperationReference(third, SECRET).capability, now: NOW })).revision).toBe(3);
  });

  it('double confirm and a lost successful response recover exactly one linked appointment', async () => {
    const operation = await prepare(randomUUID());
    const reference = customerBookingOperationReference(operation, SECRET);
    const ids = await Promise.all([createLinked(reference), createLinked(reference)]);

    expect(ids[0]).toBe(ids[1]);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
    // The response was lost. Even changed request-only contact must recover it.
    expect(await createLinked(reference, { ...CONTACT, name: 'Edited after timeout' })).toBe(ids[0]);
  });

  it('a stale failure cannot reject a newer revision or committed booking', async () => {
    const first = await prepare(randomUUID());
    const ref = customerBookingOperationReference(first, SECRET);
    const changed = material();
    changed.smsConsent = { ...changed.smsConsent!, granted: false, selection: 'explicit_off' };
    const second = await prepare(first.sessionId, 1, changed);
    const afterOldFailure = await recordCustomerBookingFailure({ salonId: SALON, secret: SECRET, ...ref, failure: 'slot_unavailable', now: NOW });

    expect(afterOldFailure.revision).toBe(2);
    expect(afterOldFailure.lastFailure).toBeNull();

    const nextRef = customerBookingOperationReference(second, SECRET);
    const id = await createLinked(nextRef);
    const afterCommit = await recordCustomerBookingFailure({ salonId: SALON, secret: SECRET, ...nextRef, failure: 'slot_unavailable', now: NOW });

    expect(afterCommit.appointmentId).toBe(id);
    expect(afterCommit.lastFailure).toBeNull();
  });

  it('deleting the appointment cannot clear the operation or permit recreation', async () => {
    const operation = await prepare(randomUUID());
    const ref = customerBookingOperationReference(operation, SECRET);
    const id = await createLinked(ref);
    await database.delete(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, id!));

    expect(await createLinked(ref)).toBe(id);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
    expect((await prepare(operation.sessionId, 0)).appointmentId).toBe(id);
  });

  it('rejects wrong tenants, malformed capabilities, wrong contact and invalid initial revisions', async () => {
    const operation = await prepare(randomUUID());
    const ref = customerBookingOperationReference(operation, SECRET);

    await expect(readCustomerBookingOperation({ salonId: OTHER, secret: SECRET, capability: ref.capability, now: NOW })).rejects.toMatchObject({ code: 'invalid_operation' });
    await expect(readCustomerBookingOperation({ salonId: SALON, secret: SECRET, capability: `${ref.capability}x`, now: NOW })).rejects.toMatchObject({ code: 'invalid_operation' });
    await expect(createLinked(ref, { ...CONTACT, phone: '4165550102' })).rejects.toMatchObject({ code: 'contact_changed' });
    await expect(prepare(randomUUID(), 4)).rejects.toMatchObject({ code: 'revision_changed' });
  });

  it('checks expiry after acquiring a contended operation row lock', async () => {
    const operation = await prepare(randomUUID());
    const ref = customerBookingOperationReference(operation, SECRET);
    const holderClient = await pool.connect();
    await holderClient.query('BEGIN');
    await holderClient.query('SELECT id FROM customer_booking_operation WHERE id=$1 FOR UPDATE', [operation.id]);
    let now = NOW;
    const waiting = database.transaction(tx => lockCustomerBookingOperation(tx, {
      salonId: SALON,
      secret: SECRET,
      contact: CONTACT,
      ...ref,
      now: () => now,
    }));
    // Attach the rejection assertion before releasing the lock.
    const assertion = expect(waiting).rejects.toMatchObject({ code: 'review_expired' });
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waitingRows = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND state=\'active\' AND wait_event_type=\'Lock\' AND query LIKE \'%customer_booking_operation%\' AND pid <> pg_backend_pid()');
        if ((waitingRows.rows[0]?.count ?? 0) > 0) {
          blocked = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      expect(blocked).toBe(true);

      now = new Date(NOW.getTime() + 6 * 60_000);
      await holderClient.query('COMMIT');
      await assertion;
    } finally {
      await holderClient.query('ROLLBACK');
      holderClient.release();
    }
  });

  it('does not consume an operation when the creation transaction rolls back', async () => {
    const operation = await prepare(randomUUID());
    const ref = customerBookingOperationReference(operation, SECRET);

    await expect(database.transaction(async (tx) => {
      await lockCustomerBookingOperation(tx, { salonId: SALON, secret: SECRET, contact: CONTACT, ...ref, now: NOW });
      throw new Error('synthetic interruption before commit');
    })).rejects.toThrow('synthetic interruption');
    expect(await createLinked(ref)).toBeTruthy();
  });
});
