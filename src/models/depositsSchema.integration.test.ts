/**
 * D1 ↔ D2 agreement, proved against the real DDL on PGlite.
 *
 * Tests 1, 2 and 34 of the D2 charter. Every assertion here runs the actual
 * `migrations/` folder, so a drift between `migrations/0065_deposits_foundation.sql`
 * and `src/models/Schema.ts` is red in THIS pull request — which is the cheapest
 * place in the ladder to discover it, because D2 merges first.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  STRIPE_WEBHOOK_EVENT_OUTCOMES,
  STRIPE_WEBHOOK_EVENT_STATUSES,
} from '@/libs/stripeConnect/webhookEvents';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
// This suite talks to its OWN PGlite instance; it must never touch the app's
// database module.
vi.mock('@/libs/DB', () => ({ db: null }));

const SALON_ID = 'salon_deposits_fixture';
const OTHER_SALON_ID = 'salon_deposits_other';
const APPOINTMENT_ID = 'appt_deposits_fixture';
const OTHER_APPOINTMENT_ID = 'appt_deposits_other';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** Postgres SQLSTATEs the constraint pins below assert on. */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FK_VIOLATION = '23503';

function sqlState(error: unknown): string | undefined {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code ?? candidate?.cause?.code;
}

async function expectSqlState(promise: Promise<unknown>, expected: string) {
  let observed: string | undefined;
  try {
    await promise;
  } catch (error) {
    observed = sqlState(error);
  }

  expect(observed).toBe(expected);
}

async function columnNamesFromCatalog(tableName: string): Promise<Set<string>> {
  const result = await db.execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = ${tableName}
  `);
  const rows = (result as unknown as { rows?: { column_name: string }[] }).rows ?? [];
  return new Set(rows.map(row => row.column_name));
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

  for (const [id, slug] of [[SALON_ID, 'deposits-fixture'], [OTHER_SALON_ID, 'deposits-other']]) {
    await db.insert(schema.salonSchema).values({
      id: id!,
      name: 'Deposits Fixture',
      slug: slug!,
    });
  }

  for (const [id, salonId] of [
    [APPOINTMENT_ID, SALON_ID],
    [OTHER_APPOINTMENT_ID, OTHER_SALON_ID],
  ]) {
    await db.insert(schema.appointmentSchema).values({
      id: id!,
      salonId: salonId!,
      clientPhone: '+14165550100',
      startTime: new Date('2026-09-01T15:00:00Z'),
      endTime: new Date('2026-09-01T16:00:00Z'),
      totalPrice: 6000,
      totalDurationMinutes: 60,
    });
  }
});

afterAll(async () => {
  await client?.close();
});

// =============================================================================
// TEST 1 — schema ↔ DDL round trip + column census
// =============================================================================

describe('test 1 — mapped tables round-trip and match the landed DDL', () => {
  it('census is set-equal in BOTH directions for all three tables', async () => {
    const tables = [
      ['salon_stripe_account', schema.salonStripeAccountSchema],
      ['appointment_deposit', schema.appointmentDepositSchema],
      ['stripe_webhook_event', schema.stripeWebhookEventSchema],
    ] as const;

    for (const [tableName, table] of tables) {
      const mapped = new Set(
        Object.values(getTableColumns(table)).map(column => column.name),
      );
      const actual = await columnNamesFromCatalog(tableName);

      // Both directions: an unmapped DDL column and a mapped column that does
      // not exist are each a failure.
      expect([...mapped].sort()).toEqual([...actual].sort());
    }
  });

  it('salon_stripe_account round-trips every mapped column', async () => {
    const row = {
      id: 'sacct_roundtrip',
      salonId: SALON_ID,
      stripeAccountId: 'acct_roundtrip',
      livemode: false,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirementsDue: {
        currently_due: ['individual.id_number'],
        eventually_due: ['company.tax_id'],
        past_due: ['individual.verification.document'],
        pending_verification: ['individual.dob'],
        current_deadline: 1790000000,
        future_current_deadline: 1795000000,
        disabled_reason: 'requirements.past_due',
      },
      disabledReason: 'requirements.past_due',
      connectedAt: new Date('2026-08-01T00:00:00Z'),
      revokedAt: new Date('2026-08-02T00:00:00Z'),
      revocationCause: 'revoked_local' as const,
      lastSyncedAt: new Date('2026-08-03T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    };

    await db.insert(schema.salonStripeAccountSchema).values(row);
    const [stored] = await db
      .select()
      .from(schema.salonStripeAccountSchema)
      .where(sql`${schema.salonStripeAccountSchema.id} = 'sacct_roundtrip'`);

    expect(stored).toEqual(row);

    await db.delete(schema.salonStripeAccountSchema)
      .where(sql`${schema.salonStripeAccountSchema.id} = 'sacct_roundtrip'`);
  });

  it('stripe_webhook_event round-trips every mapped column', async () => {
    const row = {
      id: 'swe_roundtrip',
      eventId: 'evt_roundtrip',
      type: 'account.updated',
      account: 'acct_roundtrip',
      livemode: false,
      salonId: SALON_ID,
      status: 'processed',
      outcome: 'processed',
      attempts: 3,
      availableAt: new Date('2026-08-04T00:00:00Z'),
      lastError: 'none',
      receivedAt: new Date('2026-08-01T00:00:00Z'),
      processedAt: new Date('2026-08-01T00:01:00Z'),
      sessionId: 'cs_test_1',
      paymentIntentId: 'pi_test_1',
      paymentStatus: 'paid',
      amountTotal: 5000,
      currency: 'cad',
      metadataAppointmentId: APPOINTMENT_ID,
      metadataSalonId: SALON_ID,
      metadataDepositId: 'dep_1',
      clientReferenceId: 'ref_1',
      projectionStatus: 'projected',
      rawPayload: { hello: 'world' },
      payloadPurgeAfter: new Date('2026-09-01T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    };

    await db.insert(schema.stripeWebhookEventSchema).values(row);
    const [stored] = await db
      .select()
      .from(schema.stripeWebhookEventSchema)
      .where(sql`${schema.stripeWebhookEventSchema.id} = 'swe_roundtrip'`);

    expect(stored).toEqual(row);

    await db.delete(schema.stripeWebhookEventSchema)
      .where(sql`${schema.stripeWebhookEventSchema.id} = 'swe_roundtrip'`);
  });

  it('appointment_deposit round-trips every mapped column', async () => {
    const row = {
      id: 'dep_roundtrip',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      amountCents: 2500,
      disclosedAmountCents: 3000,
      currency: 'cad',
      status: 'refunded',
      stripeAccountId: 'acct_roundtrip',
      stripeCheckoutSessionId: 'cs_roundtrip',
      stripePaymentIntentId: 'pi_roundtrip',
      stripeCheckoutUrl: 'https://checkout.example/x',
      checkoutSuccessUrl: 'https://app.example/ok',
      checkoutCancelUrl: 'https://app.example/no',
      resolutionNote: 'note',
      stripeRefundId: 're_roundtrip',
      refundedAt: new Date('2026-08-05T00:00:00Z'),
      lateCheckDoneAt: new Date('2026-08-06T00:00:00Z'),
      pollRetrievals: 2,
      pollWindowRetrievals: 1,
      pollWindowStartedAt: new Date('2026-08-07T00:00:00Z'),
      refundTerminalFailureCount: 1,
      refundKeyEpoch: 2,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    };

    await db.insert(schema.appointmentDepositSchema).values(row);
    const [stored] = await db
      .select()
      .from(schema.appointmentDepositSchema)
      .where(sql`${schema.appointmentDepositSchema.id} = 'dep_roundtrip'`);

    expect(stored).toEqual(row);

    await db.delete(schema.appointmentDepositSchema)
      .where(sql`${schema.appointmentDepositSchema.id} = 'dep_roundtrip'`);
  });
});

// =============================================================================
// TEST 2 — D1 constraint pins
// =============================================================================

describe('test 2 — 0065 constraint pins', () => {
  async function insertBinding(overrides: Partial<typeof schema.salonStripeAccountSchema.$inferInsert>) {
    return db.insert(schema.salonStripeAccountSchema).values({
      id: `sacct_${Math.random().toString(36).slice(2)}`,
      salonId: SALON_ID,
      stripeAccountId: 'acct_pin_default',
      livemode: false,
      ...overrides,
    });
  }

  it('at most one LIVE binding per salon, and per account', async () => {
    await insertBinding({ id: 'sacct_live_a', stripeAccountId: 'acct_pin_1' });

    // Second live row for the same salon.
    await expectSqlState(
      insertBinding({ id: 'sacct_live_b', stripeAccountId: 'acct_pin_2' }),
      UNIQUE_VIOLATION,
    );

    // Second live row for the same ACCOUNT under a different salon.
    await expectSqlState(
      insertBinding({
        id: 'sacct_live_c',
        salonId: OTHER_SALON_ID,
        stripeAccountId: 'acct_pin_1',
      }),
      UNIQUE_VIOLATION,
    );

    // A REVOKED row for the same salon AND the same account inserts fine. This
    // is the leg that fails if either unique index is made total, and it is what
    // makes terminal history compatible with re-binding.
    await insertBinding({
      id: 'sacct_revoked_a',
      stripeAccountId: 'acct_pin_1',
      revokedAt: new Date('2026-08-01T00:00:00Z'),
      revocationCause: 'deauthorized',
    });

    const rows = await db.select().from(schema.salonStripeAccountSchema);

    expect(rows.filter(row => row.revokedAt === null)).toHaveLength(1);

    await db.delete(schema.salonStripeAccountSchema);
  });

  it('revocation cause vocabulary and pairing are enforced', async () => {
    await expectSqlState(
      insertBinding({
        id: 'sacct_bad_cause',
        stripeAccountId: 'acct_pin_cause',
        revokedAt: new Date(),
        revocationCause: 'something_else' as never,
      }),
      CHECK_VIOLATION,
    );

    // Either half of a revocation without the other is rejected.
    await expectSqlState(
      insertBinding({
        id: 'sacct_half_a',
        stripeAccountId: 'acct_pin_half_a',
        revokedAt: new Date(),
      }),
      CHECK_VIOLATION,
    );
    await expectSqlState(
      insertBinding({
        id: 'sacct_half_b',
        stripeAccountId: 'acct_pin_half_b',
        revocationCause: 'revoked_local',
      }),
      CHECK_VIOLATION,
    );

    await db.delete(schema.salonStripeAccountSchema);
  });

  it('stripe_webhook_event.event_id is unique', async () => {
    await db.insert(schema.stripeWebhookEventSchema).values({
      id: 'swe_uniq_a',
      eventId: 'evt_uniq',
      type: 'account.updated',
      livemode: false,
      status: 'processing',
    });
    await expectSqlState(
      db.insert(schema.stripeWebhookEventSchema).values({
        id: 'swe_uniq_b',
        eventId: 'evt_uniq',
        type: 'account.updated',
        livemode: false,
        status: 'processing',
      }),
      UNIQUE_VIOLATION,
    );
    await db.delete(schema.stripeWebhookEventSchema);
  });

  async function insertDeposit(
    overrides: Partial<typeof schema.appointmentDepositSchema.$inferInsert>,
  ) {
    return db.insert(schema.appointmentDepositSchema).values({
      id: `dep_${Math.random().toString(36).slice(2)}`,
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      amountCents: 2500,
      status: 'checkout_created',
      stripeAccountId: 'acct_pin_1',
      ...overrides,
    });
  }

  it('amount must be positive and the appointment FK is tenant-ordered', async () => {
    await expectSqlState(insertDeposit({ amountCents: 0 }), CHECK_VIOLATION);

    // (salon_id, appointment_id) pointing at ANOTHER salon's appointment.
    await expectSqlState(
      insertDeposit({ appointmentId: OTHER_APPOINTMENT_ID }),
      FK_VIOLATION,
    );

    await db.delete(schema.appointmentDepositSchema);
  });

  it('2(a) currency is lowercase-only, asserted in BOTH directions', async () => {
    // A CHECK written as `upper(currency) = 'CAD'` would pass a one-sided test
    // and mean nothing.
    await expectSqlState(
      insertDeposit({ id: 'dep_upper', currency: 'CAD' }),
      CHECK_VIOLATION,
    );

    await insertDeposit({ id: 'dep_lower', currency: 'cad' });

    // And the column default is itself lowercase.
    await db.insert(schema.appointmentDepositSchema).values({
      id: 'dep_default_currency',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      amountCents: 1000,
      status: 'expired',
      stripeAccountId: 'acct_pin_1',
    });
    const [defaulted] = await db
      .select()
      .from(schema.appointmentDepositSchema)
      .where(sql`${schema.appointmentDepositSchema.id} = 'dep_default_currency'`);

    expect(defaulted?.currency).toBe('cad');

    await db.delete(schema.appointmentDepositSchema);
  });

  it('2(b) the one-active index is PARTIAL, not total', async () => {
    // Two TERMINAL rows for one appointment insert fine.
    await insertDeposit({ id: 'dep_term_1', status: 'expired' });
    await insertDeposit({ id: 'dep_term_2', status: 'canceled' });

    // One non-terminal row is allowed…
    await insertDeposit({ id: 'dep_active_1', status: 'checkout_created' });
    // …a second is not.
    await expectSqlState(
      insertDeposit({ id: 'dep_active_2', status: 'paid' }),
      UNIQUE_VIOLATION,
    );

    await db.delete(schema.appointmentDepositSchema);
  });

  it('2(c) three provider-id uniques, and NULLs do not collide', async () => {
    await insertDeposit({
      id: 'dep_ids_1',
      status: 'expired',
      stripeCheckoutSessionId: 'cs_1',
      stripePaymentIntentId: 'pi_1',
      stripeRefundId: 're_1',
    });

    await expectSqlState(
      insertDeposit({ id: 'dep_dup_cs', status: 'expired', stripeCheckoutSessionId: 'cs_1' }),
      UNIQUE_VIOLATION,
    );
    await expectSqlState(
      insertDeposit({ id: 'dep_dup_pi', status: 'expired', stripePaymentIntentId: 'pi_1' }),
      UNIQUE_VIOLATION,
    );
    await expectSqlState(
      insertDeposit({ id: 'dep_dup_re', status: 'expired', stripeRefundId: 're_1' }),
      UNIQUE_VIOLATION,
    );

    // Two rows with NULL in each of the three admit fine.
    await insertDeposit({ id: 'dep_nulls_1', status: 'expired' });
    await insertDeposit({ id: 'dep_nulls_2', status: 'canceled' });

    await db.delete(schema.appointmentDepositSchema);
  });

  it('2(d) refund bookkeeping defaults are 0 and ONE', async () => {
    await db.insert(schema.appointmentDepositSchema).values({
      id: 'dep_defaults',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      amountCents: 1000,
      status: 'expired',
      stripeAccountId: 'acct_pin_1',
    });

    const [stored] = await db
      .select()
      .from(schema.appointmentDepositSchema)
      .where(sql`${schema.appointmentDepositSchema.id} = 'dep_defaults'`);

    expect(stored?.refundTerminalFailureCount).toBe(0);
    // ONE, not zero — first-attempt refund idempotency keys depend on it.
    expect(stored?.refundKeyEpoch).toBe(1);

    await db.delete(schema.appointmentDepositSchema);
  });
});

// =============================================================================
// TEST 34 — event vocabulary closure
// =============================================================================

describe('test 34 — every literal D2 declares is accepted by the landed 0065', () => {
  it('34(c) the exported status set is EXACTLY 0065\'s CHECK vocabulary', () => {
    // Driven from the exported const, never from literals retyped into the
    // test — retyping is how a vocabulary drifts to a third list.
    //
    // WIDENED BY THE PAYMENT-CONFIRMATION PR, which is the writer of the
    // remaining eleven terminals. The constant was always a SUBSET of 0065's
    // CHECK — the constraint is the union of both writers' vocabularies — and
    // now equals it, so this assertion pins the constant to the DDL rather than
    // to one packet's slice of it. `received` stays deliberately absent.
    expect([...STRIPE_WEBHOOK_EVENT_STATUSES].sort()).toEqual([
      'account_mismatch',
      'failed_retryable',
      'held_duplicate_session',
      'held_mismatch',
      'ignored_foreign_session',
      'ignored_livemode',
      'ignored_non_connect_scope',
      'ignored_over_cap',
      'ignored_unhandled',
      'ignored_unpaid',
      'orphan_unresolved',
      'poisoned',
      'processed',
      'processing',
      'unbound_unresolved',
    ]);
    expect([...STRIPE_WEBHOOK_EVENT_STATUSES]).not.toContain('received');
  });

  it('34(c2) the outcome set still contains every literal this route writes', () => {
    // `outcome` carries NO CHECK, so this array is an app-level union rather
    // than a DDL contract and it GROWS as writers are added. What must not
    // change is that the Connect account-lifecycle arms keep theirs: those are
    // the literals the cross-route runbook queries key on.
    for (const outcome of [
      'disabled_by_flag',
      'ignored_livemode',
      'ignored_non_connect_scope',
      'ignored_revoked_binding',
      'ignored_unhandled',
      'permanent_provider_error',
      'poisoned',
      'processed',
      'unbound_account',
      'unbound_unresolved',
    ]) {
      expect(STRIPE_WEBHOOK_EVENT_OUTCOMES).toContain(outcome);
    }
  });

  it('34(a) every declared status inserts without a CHECK violation', async () => {
    for (const [index, status] of STRIPE_WEBHOOK_EVENT_STATUSES.entries()) {
      // `poisoned` is included PRECISELY because D2 never writes it: a later PR
      // does, and the CHECK must already admit it.
      await db.insert(schema.stripeWebhookEventSchema).values({
        id: `swe_status_${index}`,
        eventId: `evt_status_${index}`,
        type: 'account.updated',
        livemode: false,
        status,
      });
    }
    const rows = await db.select().from(schema.stripeWebhookEventSchema);

    expect(rows).toHaveLength(STRIPE_WEBHOOK_EVENT_STATUSES.length);

    await db.delete(schema.stripeWebhookEventSchema);
  });

  it('34(b) every declared outcome inserts without a CHECK violation', async () => {
    for (const [index, outcome] of STRIPE_WEBHOOK_EVENT_OUTCOMES.entries()) {
      await db.insert(schema.stripeWebhookEventSchema).values({
        id: `swe_outcome_${index}`,
        eventId: `evt_outcome_${index}`,
        type: 'account.updated',
        livemode: false,
        status: 'processed',
        outcome,
      });
    }
    const rows = await db.select().from(schema.stripeWebhookEventSchema);

    expect(rows).toHaveLength(STRIPE_WEBHOOK_EVENT_OUTCOMES.length);

    await db.delete(schema.stripeWebhookEventSchema);
  });

  it('34(e2) cross-route reads key on outcome, not status', async () => {
    // A D2-shaped row: the disposition lives in `outcome`, the lifecycle in
    // `status`.
    await db.insert(schema.stripeWebhookEventSchema).values({
      id: 'swe_shape_d2',
      eventId: 'evt_shape_d2',
      type: 'account.updated',
      livemode: false,
      status: 'processed',
      outcome: 'ignored_livemode',
    });
    // A later-PR-shaped FIXTURE row, which uses the literal as an absorbing
    // lifecycle position. D2's own code writes no `ignored_*` into `status`.
    await db.insert(schema.stripeWebhookEventSchema).values({
      id: 'swe_shape_d5',
      eventId: 'evt_shape_d5',
      type: 'checkout.session.completed',
      livemode: false,
      status: 'ignored_livemode',
      outcome: 'ignored_livemode',
    });

    const byOutcome = await db
      .select()
      .from(schema.stripeWebhookEventSchema)
      .where(sql`${schema.stripeWebhookEventSchema.outcome} = 'ignored_livemode'`);
    const byStatus = await db
      .select()
      .from(schema.stripeWebhookEventSchema)
      .where(sql`${schema.stripeWebhookEventSchema.status} = 'ignored_livemode'`);

    // Re-expressing the first query on `status` would silently drop the
    // D2-shaped row — the exact failure the read rule exists to prevent.
    expect(byOutcome).toHaveLength(2);
    expect(byStatus).toHaveLength(1);

    await db.delete(schema.stripeWebhookEventSchema);
  });
});
