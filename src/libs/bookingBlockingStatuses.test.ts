import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// eslint-disable-next-line import/first
import { BLOCKING_APPOINTMENT_STATUSES } from './bookingConflictGuard';

/**
 * The set of appointment statuses that "occupy" a technician's slot is
 * duplicated across places that MUST agree —
 *   1. BLOCKING_APPOINTMENT_STATUSES (src/libs/bookingConflictGuard.ts)
 *   2. loadBookingPolicy's availability query (src/libs/bookingPolicy.ts),
 *      which imports the constant, so it is covered by (1)
 *   3. the partial-unique-index and gist-exclusion predicates in the migrations
 * If (1) and (3) diverge, the in-transaction conflict re-check and the DB-level
 * backstops disagree about which rows block a slot — silently weakening
 * double-booking prevention.
 *
 * THIS GUARD RESOLVES THE *EFFECTIVE* PREDICATE, NOT A FIXED FILE. Migrations
 * are forward-only and a later migration may drop and recreate both objects
 * with a widened predicate (0066 does exactly that, adding 'awaiting_payment').
 * Pinning this test to 0054 — or, worse, hardcoding the expected array — would
 * turn the repository's only constant-to-DDL drift guard into a no-op in the
 * very migration that first makes them disagree. So: glob the migrations, sort
 * by numeric index, and compare against the LAST file that recreates them.
 */

const UNIQUE_INDEX_NAME = 'appointment_tech_active_slot_unique';
const EXCLUSION_CONSTRAINT_NAME = 'appointment_tech_active_no_overlap';

const migrationsDir = path.join(process.cwd(), 'migrations');

/** `0066_deposit_hold_awaiting_payment.sql` -> 66 */
function migrationIndex(fileName: string): number {
  const parsed = Number.parseInt(fileName.slice(0, 4), 10);
  return Number.isNaN(parsed) ? -1 : parsed;
}

/** A file *recreates* an object when it creates/adds it, not merely names it. */
function recreatesUniqueIndex(sql: string): boolean {
  return new RegExp(`CREATE\\s+UNIQUE\\s+INDEX[\\s\\S]*?"?${UNIQUE_INDEX_NAME}"?`, 'i').test(sql);
}

function recreatesExclusionConstraint(sql: string): boolean {
  return new RegExp(`ADD\\s+CONSTRAINT\\s+"?${EXCLUSION_CONSTRAINT_NAME}"?`, 'i').test(sql);
}

const migrationFiles = readdirSync(migrationsDir)
  .filter(name => name.endsWith('.sql'))
  .sort((a, b) => migrationIndex(a) - migrationIndex(b));

const definingMigrations = migrationFiles
  .map(name => ({ name, sql: readFileSync(path.join(migrationsDir, name), 'utf8') }))
  .filter(({ sql }) => recreatesUniqueIndex(sql) || recreatesExclusionConstraint(sql));

const effective = definingMigrations.at(-1);

describe('BLOCKING_APPOINTMENT_STATUSES ↔ the effective double-booking predicate', () => {
  it('resolves a migration that defines the double-booking backstops', () => {
    expect(definingMigrations.length).toBeGreaterThan(0);
    expect(effective).toBeDefined();
  });

  it('the effective migration recreates BOTH backstops, not just one', () => {
    // A migration that widens the unique index but forgets the exclusion
    // constraint leaves overlapping (not equal-start) holds unblocked.
    expect(recreatesUniqueIndex(effective!.sql)).toBe(true);
    expect(recreatesExclusionConstraint(effective!.sql)).toBe(true);
  });

  it('every status predicate in the effective migration equals BLOCKING_APPOINTMENT_STATUSES', () => {
    const predicateLists = [...effective!.sql.matchAll(/"status"\s+IN\s+\(([^)]*)\)/gi)].map(match =>
      (match[1] ?? '')
        .split(',')
        .map(token => token.trim().replace(/^'|'$/g, ''))
        .filter(Boolean),
    );

    expect(predicateLists.length).toBeGreaterThan(0);

    const expected = [...BLOCKING_APPOINTMENT_STATUSES].sort();
    for (const list of predicateLists) {
      expect(list.slice().sort()).toEqual(expected);
    }
  });

  it('BLOCKING_APPOINTMENT_STATUSES has no duplicates', () => {
    expect(new Set(BLOCKING_APPOINTMENT_STATUSES).size).toBe(BLOCKING_APPOINTMENT_STATUSES.length);
  });

  it('the documented set is derived from the constant, and holds occupy the slot', () => {
    // Derived, NOT hardcoded: a hardcoded literal here has to be edited by the
    // same change that widens the constant, so it can never detect drift.
    const documented = [...BLOCKING_APPOINTMENT_STATUSES].sort();
    expect(documented).toEqual([...new Set(documented)]);

    // The one membership claim this file is entitled to make on its own:
    // a deposit hold IS the appointment row, so it must block the slot.
    expect(BLOCKING_APPOINTMENT_STATUSES).toContain('awaiting_payment');
  });
});
