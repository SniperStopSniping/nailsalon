import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// eslint-disable-next-line import/first
import { BLOCKING_APPOINTMENT_STATUSES } from './bookingConflictGuard';

/**
 * Prompt 9 audit fix: the set of appointment statuses that "occupy" a
 * technician's slot is duplicated across three places that MUST agree —
 *   1. BLOCKING_APPOINTMENT_STATUSES (src/libs/bookingConflictGuard.ts)
 *   2. loadBookingPolicy's availability query (src/libs/bookingPolicy.ts) —
 *      now imports the constant (this session's fix), so it's covered by (1).
 *   3. the partial-index / exclusion predicate in
 *      migrations/0054_prevent_double_booking.sql
 * If (1) and (3) ever diverge, the in-transaction conflict re-check and the
 * DB-level unique/exclusion constraints would disagree about which rows block
 * a slot — silently weakening or breaking double-booking prevention. This
 * test pins the constant to the migration predicate so the drift cannot land
 * unnoticed.
 */
describe('BLOCKING_APPOINTMENT_STATUSES ↔ migration 0054 predicate', () => {
  const migrationSql = readFileSync(
    path.join(process.cwd(), 'migrations', '0054_prevent_double_booking.sql'),
    'utf8',
  );

  // Every `"status" IN ('a', 'b', ...)` list in the migration.
  const predicateLists = [...migrationSql.matchAll(/"status"\s+IN\s+\(([^)]*)\)/gi)].map(match =>
    (match[1] ?? '')
      .split(',')
      .map(token => token.trim().replace(/^'|'$/g, ''))
      .filter(Boolean),
  );

  it('the migration actually contains status predicates to compare against', () => {
    expect(predicateLists.length).toBeGreaterThan(0);
  });

  it('every migration status predicate equals BLOCKING_APPOINTMENT_STATUSES (order-independent)', () => {
    const expected = [...BLOCKING_APPOINTMENT_STATUSES].sort();
    for (const list of predicateLists) {
      expect(list.slice().sort()).toEqual(expected);
    }
  });

  it('BLOCKING_APPOINTMENT_STATUSES has no duplicates and matches the documented set', () => {
    expect(new Set(BLOCKING_APPOINTMENT_STATUSES).size).toBe(BLOCKING_APPOINTMENT_STATUSES.length);
    expect([...BLOCKING_APPOINTMENT_STATUSES].sort()).toEqual(
      ['confirmed', 'in_progress', 'pending'],
    );
  });
});
