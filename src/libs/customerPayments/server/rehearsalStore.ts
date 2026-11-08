import 'server-only';

import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import type { CustomerPaymentAttempt, CustomerPaymentObservation } from '../attempt';
import { applyCustomerPaymentObservation, bindCustomerPaymentApplicationFee, bindCustomerPaymentSession, prepareCustomerPaymentAttempt, recordCustomerPaymentFeeRefund, recordCustomerPaymentRefund } from '../attempt';
import type { CustomerPaymentsRuntime } from '../policy';
import { assertCustomerPaymentsRuntime } from '../policy';

const schema = `
CREATE TABLE IF NOT EXISTS rehearsal_attempt (
  reference_id text PRIMARY KEY,
  salon_id text NOT NULL,
  appointment_id text NOT NULL,
  account_id text NOT NULL,
  mode text NOT NULL CHECK (mode = 'test'),
  snapshot jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  state jsonb NOT NULL,
  UNIQUE (salon_id, appointment_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS rehearsal_payment_intent_unique
  ON rehearsal_attempt (account_id, (state->>'paymentIntentId'))
  WHERE state->>'paymentIntentId' IS NOT NULL;
CREATE TABLE IF NOT EXISTS rehearsal_receipt (
  account_id text NOT NULL,
  kind text NOT NULL,
  external_id text NOT NULL,
  reference_id text NOT NULL REFERENCES rehearsal_attempt(reference_id),
  evidence jsonb NOT NULL,
  PRIMARY KEY (account_id, kind, external_id)
);`;

/**
 * Durable LOCAL rehearsal only. Never imports DB, Stripe or appointment tables.
 * The directory must be a caller-created direct child of the OS temp directory.
 * No runtime flag, URL or injected database can turn this into a live adapter.
 */
export async function openCustomerPaymentRehearsalStore(directory: string, runtime: CustomerPaymentsRuntime) {
  assertCustomerPaymentsRuntime(runtime);
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production') {
    throw new Error('CUSTOMER_PAYMENTS_DISABLED');
  }
  const root = await realpath(directory);
  if (dirname(root) !== await realpath(tmpdir()) || !/^luster-payment-rehearsal-[a-z0-9]+$/i.test(basename(root))) {
    throw new Error('ISOLATED_REHEARSAL_DIRECTORY_REQUIRED');
  }
  const db = new PGlite(join(root, 'database'));
  await db.exec(schema);

  async function read(referenceId: string, salonId: string) {
    const result = await db.query<{ state: CustomerPaymentAttempt }>(
      'SELECT state FROM rehearsal_attempt WHERE reference_id = $1 AND salon_id = $2',
      [referenceId, salonId],
    );
    if (!result.rows[0]) {
      throw new Error('PAYMENT_ATTEMPT_NOT_FOUND');
    }
    return result.rows[0].state;
  }

  async function mutate(input: {
    referenceId: string;
    salonId: string;
    expectedRevision: number;
    receipt: { accountId: string; kind: string; id: string; evidence: unknown };
    apply: (attempt: CustomerPaymentAttempt) => CustomerPaymentAttempt;
  }) {
    const committed = await db.transaction(async (tx) => {
      const result = await tx.query<{ state: CustomerPaymentAttempt }>(
        'SELECT state FROM rehearsal_attempt WHERE reference_id = $1 AND salon_id = $2 FOR UPDATE',
        [input.referenceId, input.salonId],
      );
      const before = result.rows[0]?.state;
      if (!before) {
        throw new Error('PAYMENT_ATTEMPT_NOT_FOUND');
      }
      if (input.receipt.accountId !== before.stripeAccountId) {
        throw new Error('PAYMENT_ACCOUNT_MISMATCH');
      }
      const existing = await tx.query<{ reference_id: string; matches: boolean }>(
        `SELECT reference_id, evidence = $4::jsonb AS matches FROM rehearsal_receipt
         WHERE account_id = $1 AND kind = $2 AND external_id = $3`,
        [input.receipt.accountId, input.receipt.kind, input.receipt.id, JSON.stringify(input.receipt.evidence)],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].reference_id !== input.referenceId || !existing.rows[0].matches) {
          throw new Error('PAYMENT_RECEIPT_CONFLICT');
        }
        return before;
      }
      if (before.revision !== input.expectedRevision) {
        throw new Error('PAYMENT_ATTEMPT_REVISION_CONFLICT');
      }
      const after = input.apply(before);
      await tx.query(
        `INSERT INTO rehearsal_receipt (account_id, kind, external_id, reference_id, evidence)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.receipt.accountId, input.receipt.kind, input.receipt.id, input.referenceId, JSON.stringify(input.receipt.evidence)],
      );
      const updated = await tx.query(
        `UPDATE rehearsal_attempt SET state = $1, revision = $2
         WHERE reference_id = $3 AND salon_id = $4 AND revision = $5 RETURNING reference_id`,
        [JSON.stringify(after), after.revision, input.referenceId, input.salonId, input.expectedRevision],
      );
      if (updated.rows.length !== 1) {
        throw new Error('PAYMENT_ATTEMPT_REVISION_CONFLICT');
      }
      return after;
    });
    if (!committed) {
      throw new Error('PAYMENT_TRANSACTION_NOT_COMMITTED');
    }
    return committed;
  }

  return {
    close: () => db.close(),
    read,
    async prepare(input: Parameters<typeof prepareCustomerPaymentAttempt>[0]) {
      const state = prepareCustomerPaymentAttempt(input);
      // One immutable attempt per rehearsal appointment; never silently open a
      // second collectible attempt after payment, expiry, refund or uncertainty.
      await db.query(
        `INSERT INTO rehearsal_attempt
         (reference_id, salon_id, appointment_id, account_id, mode, snapshot, revision, state)
         VALUES ($1, $2, $3, $4, 'test', $5, $6, $7)`,
        [state.referenceId, state.salonId, state.appointmentId, state.stripeAccountId, JSON.stringify(state.snapshot), state.revision, JSON.stringify(state)],
      );
      return state;
    },
    bind(referenceId: string, salonId: string, expectedRevision: number, session: Parameters<typeof bindCustomerPaymentSession>[1]) {
      return mutate({ referenceId, salonId, expectedRevision, receipt: { accountId: session.stripeAccountId, kind: 'session', id: session.id, evidence: session }, apply: attempt => bindCustomerPaymentSession(attempt, session) });
    },
    observe(salonId: string, expectedRevision: number, evidence: CustomerPaymentObservation) {
      if (evidence.livemode !== false) {
        throw new Error('LIVE_EVIDENCE_FORBIDDEN');
      }
      // Arrival time is not event identity: retries may be observed later.
      const { observedAt: _observedAt, ...stableEvidence } = evidence;
      return mutate({ referenceId: evidence.referenceId, salonId, expectedRevision, receipt: { accountId: evidence.stripeAccountId, kind: 'event', id: evidence.eventId, evidence: stableEvidence }, apply: attempt => applyCustomerPaymentObservation(attempt, evidence, expectedRevision) });
    },
    bindApplicationFee(referenceId: string, salonId: string, expectedRevision: number, evidence: Parameters<typeof bindCustomerPaymentApplicationFee>[1]) {
      return mutate({ referenceId, salonId, expectedRevision, receipt: { accountId: evidence.stripeAccountId, kind: 'application_fee', id: evidence.id, evidence }, apply: attempt => bindCustomerPaymentApplicationFee(attempt, evidence, expectedRevision) });
    },
    feeRefund(referenceId: string, salonId: string, expectedRevision: number, evidence: Parameters<typeof recordCustomerPaymentFeeRefund>[1]) {
      return mutate({ referenceId, salonId, expectedRevision, receipt: { accountId: evidence.stripeAccountId, kind: 'fee_refund', id: evidence.id, evidence }, apply: attempt => recordCustomerPaymentFeeRefund(attempt, evidence, expectedRevision) });
    },
    refund(referenceId: string, salonId: string, expectedRevision: number, evidence: Parameters<typeof recordCustomerPaymentRefund>[1]) {
      return mutate({ referenceId, salonId, expectedRevision, receipt: { accountId: evidence.stripeAccountId, kind: 'refund', id: evidence.id, evidence }, apply: attempt => recordCustomerPaymentRefund(attempt, evidence, expectedRevision).attempt });
    },
  };
}
