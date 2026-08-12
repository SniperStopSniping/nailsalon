import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

import type { db } from '@/libs/DB';

/**
 * THE ONLY TRANSACTION SEAM FOR `src/libs/deposits/**`.
 *
 * Invariant I9 — "provider calls never run inside a DB transaction or while
 * holding row/advisory locks" — is not a review rule here, it is an executable
 * one. A Stripe call made while a transaction holds `appointment` and
 * `appointment_deposit` row locks turns a provider timeout into a lock held for
 * the whole timeout, on the two rows every other deposit writer needs.
 *
 * The mechanism is deliberately boring: one `AsyncLocalStorage` flag entered for
 * the duration of every deposits-lib transaction callback, and one exported
 * predicate the Stripe mock consults. A bare `db.transaction` inside
 * `src/libs/deposits/` bypasses the flag, which is why a structural test scans
 * for one and why every call in this directory goes through this function.
 *
 * The store is entered around the CALLBACK, not around `db.transaction` itself,
 * so a provider call made between two transactions is correctly NOT flagged.
 */

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DepositsDatabase = Pick<typeof db, 'transaction'>;

const inDepositsTransaction = new AsyncLocalStorage<true>();

/**
 * True while the caller is executing inside a `depositsTransaction` callback.
 *
 * Consumed by the instrumented Stripe mock (harness H5) and by nothing in
 * production code — production correctness comes from the call sites, and this
 * predicate is what proves they stayed correct.
 */
export function isInsideDepositsTransaction(): boolean {
  return inDepositsTransaction.getStore() === true;
}

/**
 * Runs `fn` inside a database transaction, flagged for the in-transaction
 * provider-call detector.
 *
 * `database` is a parameter rather than a module import so tests can drive the
 * seam against a scoped handle; production callers pass the shared `db`.
 */
export async function depositsTransaction<T>(
  database: DepositsDatabase,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return database.transaction(async tx => inDepositsTransaction.run(true, () => fn(tx)));
}

export type DepositsTransactionHandle = Transaction;
