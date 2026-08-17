import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import {
  buildBookingTaxSnapshot,
  buildFinalTaxSnapshot,
  buildForfeitureTaxSnapshot,
  resolveTaxConfig,
} from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: null }));

const SALON_ID = 'salon_d61_schema';
const APPOINTMENT_A = 'appt_d61_schema_a';
const APPOINTMENT_B = 'appt_d61_schema_b';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const CAPTURED_AT = new Date('2026-08-15T05:00:00Z');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function sqlState(error: unknown): string | undefined {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code ?? candidate.cause?.code;
}

async function expectSqlState(promise: Promise<unknown>, expected: string): Promise<void> {
  let observed: string | undefined;
  try {
    await promise;
  } catch (error) {
    observed = sqlState(error);
  }

  expect(observed).toBe(expected);
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'D6.1 Schema Salon',
    slug: 'd61-schema-salon',
  });
  await db.insert(schema.salonSchema).values({
    id: 'salon_d61_other',
    name: 'D6.1 Other Salon',
    slug: 'd61-other-salon',
  });

  for (const [id, hour] of [[APPOINTMENT_A, 14], [APPOINTMENT_B, 16]] as const) {
    await db.insert(schema.appointmentSchema).values({
      id,
      salonId: SALON_ID,
      clientPhone: '+14165550100',
      startTime: new Date(`2026-08-20T${hour}:00:00Z`),
      endTime: new Date(`2026-08-20T${hour + 1}:00:00Z`),
      totalPrice: 10000,
      totalDurationMinutes: 60,
    });
  }

  await db.insert(schema.appointmentDepositSchema).values({
    id: 'dep_d61_historical',
    salonId: SALON_ID,
    appointmentId: APPOINTMENT_A,
    amountCents: 2500,
    status: 'expired',
    stripeAccountId: 'acct_d61_schema',
  });
  await db.insert(schema.appointmentPaymentSchema).values({
    id: 'pay_d61_historical',
    salonId: SALON_ID,
    appointmentId: APPOINTMENT_A,
    amountCents: 100,
    recordedByType: 'system',
  });
});

afterAll(async () => {
  await client?.close();
});

describe('migration 0068 — D6.1 invoice and tax snapshot foundation', () => {
  it('maps every new DDL column through the Drizzle schema', async () => {
    const expected = [
      [schema.appointmentSchema, [
        'invoice_currency',
        'booking_tax_snapshot',
        'reschedule_tax_snapshot',
        'final_tax_snapshot',
      ]],
      [schema.appointmentDepositSchema, ['collected_at', 'forfeited_at', 'forfeiture_tax_snapshot']],
      [schema.appointmentPaymentSchema, ['idempotency_key']],
    ] as const;

    for (const [table, names] of expected) {
      const mapped = new Set(Object.values(getTableColumns(table)).map(column => column.name));
      for (const name of names) {
        expect(mapped.has(name), `${name} is not mapped`).toBe(true);
      }
    }

    const result = await db.execute(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'appointment' and column_name in (
            'invoice_currency', 'booking_tax_snapshot', 'reschedule_tax_snapshot',
            'final_tax_snapshot'
          ))
          or (table_name = 'appointment_deposit' and column_name in (
            'collected_at', 'forfeited_at', 'forfeiture_tax_snapshot'
          ))
          or (table_name = 'appointment_payment' and column_name = 'idempotency_key')
        )
    `);
    const rows = (result as unknown as { rows?: { table_name: string; column_name: string }[] }).rows ?? [];

    expect(rows.map(row => `${row.table_name}.${row.column_name}`).sort()).toEqual([
      'appointment.booking_tax_snapshot',
      'appointment.final_tax_snapshot',
      'appointment.invoice_currency',
      'appointment.reschedule_tax_snapshot',
      'appointment_deposit.collected_at',
      'appointment_deposit.forfeited_at',
      'appointment_deposit.forfeiture_tax_snapshot',
      'appointment_payment.idempotency_key',
    ]);
  });

  it('backfills proven CAD deposit appointments but leaves other historical facts NULL', async () => {
    const [beforeBackfill] = await db.select().from(schema.appointmentSchema)
      .where(sql`${schema.appointmentSchema.id} = ${APPOINTMENT_A}`);

    expect(beforeBackfill?.invoiceCurrency).toBeNull();

    // The main migrator necessarily ran before this fixture existed. Reapply
    // the literal idempotent 0068 statements so this test exercises the shipped
    // backfill itself against a simulated pre-0068 deposit appointment.
    const migrationSql = readFileSync(
      path.join(process.cwd(), 'migrations/0068_deposit_credit_tax_snapshots.sql'),
      'utf8',
    );
    for (const statement of migrationSql.split('--> statement-breakpoint')) {
      if (statement.trim()) {
        await client.exec(statement);
      }
    }

    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(sql`${schema.appointmentSchema.id} = ${APPOINTMENT_A}`);
    const [appointmentWithoutDeposit] = await db.select().from(schema.appointmentSchema)
      .where(sql`${schema.appointmentSchema.id} = ${APPOINTMENT_B}`);
    const [deposit] = await db.select().from(schema.appointmentDepositSchema)
      .where(sql`${schema.appointmentDepositSchema.id} = 'dep_d61_historical'`);
    const [payment] = await db.select().from(schema.appointmentPaymentSchema)
      .where(sql`${schema.appointmentPaymentSchema.id} = 'pay_d61_historical'`);

    expect(appointment).toMatchObject({
      invoiceCurrency: 'CAD',
      bookingTaxSnapshot: null,
      rescheduleTaxSnapshot: null,
      finalTaxSnapshot: null,
    });
    expect(appointmentWithoutDeposit).toMatchObject({
      invoiceCurrency: null,
      bookingTaxSnapshot: null,
      rescheduleTaxSnapshot: null,
      finalTaxSnapshot: null,
    });
    expect(deposit).toMatchObject({
      collectedAt: null,
      forfeitedAt: null,
      forfeitureTaxSnapshot: null,
    });
    expect(payment?.idempotencyKey).toBeNull();
  });

  it('round-trips typed booking, final, and forfeiture snapshots', async () => {
    const taxConfig = resolveTaxConfig({
      payments: {
        tax: {
          enabled: true,
          name: 'HST',
          rateBps: 1300,
          jurisdiction: 'Ontario HST',
          country: 'CA',
          region: 'ON',
        },
      },
    }, CAPTURED_AT);
    const totals = computeCheckoutTotals({
      items: [{ lineTotalCents: 10000, taxable: true }],
      taxConfig,
    });
    const bookingTaxSnapshot = buildBookingTaxSnapshot({
      taxConfig,
      totals,
      capturedAt: CAPTURED_AT,
      currency: 'CAD',
    });
    const finalTaxSnapshot = buildFinalTaxSnapshot({
      taxConfig,
      totals,
      capturedAt: CAPTURED_AT,
      currency: 'CAD',
    });
    const forfeitureTaxSnapshot = buildForfeitureTaxSnapshot({
      taxConfig,
      grossForfeitedCents: 2500,
      capturedAt: CAPTURED_AT,
      currency: 'CAD',
      estimateTaxIncluded: true,
    });

    await db.update(schema.appointmentSchema).set({
      invoiceCurrency: 'CAD',
      bookingTaxSnapshot,
      rescheduleTaxSnapshot: bookingTaxSnapshot,
      finalTaxSnapshot,
    }).where(sql`${schema.appointmentSchema.id} = ${APPOINTMENT_A}`);
    await db.update(schema.appointmentDepositSchema).set({
      collectedAt: CAPTURED_AT,
      forfeitedAt: CAPTURED_AT,
      forfeitureTaxSnapshot,
    }).where(sql`${schema.appointmentDepositSchema.id} = 'dep_d61_historical'`);

    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(sql`${schema.appointmentSchema.id} = ${APPOINTMENT_A}`);
    const [deposit] = await db.select().from(schema.appointmentDepositSchema)
      .where(sql`${schema.appointmentDepositSchema.id} = 'dep_d61_historical'`);

    expect(appointment).toMatchObject({
      invoiceCurrency: 'CAD',
      bookingTaxSnapshot,
      rescheduleTaxSnapshot: bookingTaxSnapshot,
      finalTaxSnapshot,
    });
    expect(deposit).toMatchObject({ collectedAt: CAPTURED_AT, forfeitedAt: CAPTURED_AT, forfeitureTaxSnapshot });
  });

  it('accepts only supported uppercase invoice currencies', async () => {
    await expectSqlState(
      db.update(schema.appointmentSchema)
        .set({ invoiceCurrency: 'cad' })
        .where(sql`${schema.appointmentSchema.id} = ${APPOINTMENT_A}`),
      CHECK_VIOLATION,
    );

    await expect(db.update(schema.appointmentSchema)
      .set({ invoiceCurrency: 'USD' })
      .where(sql`${schema.appointmentSchema.id} = ${APPOINTMENT_A}`)).resolves.toBeDefined();
  });

  it('deduplicates explicit payment retry keys per tenant and appointment only', async () => {
    const payment = (id: string, appointmentId: string, idempotencyKey: string | null) => ({
      id,
      salonId: SALON_ID,
      appointmentId,
      amountCents: 100,
      recordedByType: 'system',
      idempotencyKey,
    });

    await db.insert(schema.appointmentPaymentSchema).values([
      payment('pay_d61_null_a', APPOINTMENT_A, null),
      payment('pay_d61_null_b', APPOINTMENT_A, null),
      payment('pay_d61_key_a', APPOINTMENT_A, 'retry-key-1'),
      payment('pay_d61_key_other_appt', APPOINTMENT_B, 'retry-key-1'),
    ]);
    await expectSqlState(
      db.insert(schema.appointmentPaymentSchema).values(
        payment('pay_d61_key_duplicate', APPOINTMENT_A, 'retry-key-1'),
      ),
      UNIQUE_VIOLATION,
    );

    const indexResult = await db.execute(sql`
      select indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'appointment_payment_tenant_idempotency_uniq'
    `);
    const indexRows = (indexResult as unknown as { rows?: { indexdef: string }[] }).rows ?? [];

    expect(indexRows).toHaveLength(1);
    expect(indexRows[0]?.indexdef).toContain('(salon_id, appointment_id, idempotency_key)');
    expect(indexRows[0]?.indexdef).toContain('WHERE (idempotency_key IS NOT NULL)');
  });

  it('tenant-binds payment rows to their appointment and validates a clean historical cohort', async () => {
    await expectSqlState(
      db.insert(schema.appointmentPaymentSchema).values({
        id: 'pay_d61_cross_tenant',
        salonId: 'salon_d61_other',
        appointmentId: APPOINTMENT_A,
        amountCents: 100,
        recordedByType: 'system',
      }),
      FOREIGN_KEY_VIOLATION,
    );

    const result = await db.execute(sql`
      select convalidated
      from pg_constraint
      where conname = 'appointment_payment_appointment_tenant_fk'
    `);
    const rows = (result as unknown as { rows?: { convalidated: boolean }[] }).rows ?? [];

    expect(rows).toEqual([{ convalidated: true }]);
  });

  it('pins the next journal identity and migration count', () => {
    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), 'migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; when: number; tag: string }[] };

    expect(journal.entries).toHaveLength(71);
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 70,
      when: 1786957992670,
      tag: '0070_communications_pipeline',
    });
  });
});
