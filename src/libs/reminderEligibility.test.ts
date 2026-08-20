import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import {
  getValueImportSpecifiers,
  readSourceFiles,
  resolveModuleSpecifier,
  stripComments,
} from './architectureGuardSupport';

vi.mock('server-only', () => ({}));

// eslint-disable-next-line import/first
import {
  isReminderEligibleAppointment,
  reminderEligibleAppointmentCondition,
} from './reminderEligibility';

/**
 * L1 PR5 — F. Covers the pure predicate, the SQL fragment (differentially,
 * against a real PGlite database), and a structural drift guard so a future
 * edit that reintroduces a bare `inArray(status, ['pending', 'confirmed'])`
 * at one of the three known call sites in `appointmentReminders.ts` fails
 * the suite instead of silently regressing. Mirrors
 * `appointmentBlocking.test.ts`'s structure exactly.
 */

// =============================================================================
// PURE PREDICATE
// =============================================================================

describe('isReminderEligibleAppointment', () => {
  it('confirmed always eligible, regardless of requestExpiresAt', () => {
    expect(isReminderEligibleAppointment({ status: 'confirmed', requestExpiresAt: null })).toBe(true);
    expect(
      isReminderEligibleAppointment({ status: 'confirmed', requestExpiresAt: new Date('2000-01-01T00:00:00Z') }),
    ).toBe(true);
  });

  it.each(['cancelled', 'completed', 'no_show', 'in_progress', 'awaiting_payment'] as const)(
    '%s is never eligible',
    (status) => {
      expect(isReminderEligibleAppointment({ status, requestExpiresAt: null })).toBe(false);
    },
  );

  it('legacy pending (NULL requestExpiresAt) is eligible', () => {
    expect(isReminderEligibleAppointment({ status: 'pending', requestExpiresAt: null })).toBe(true);
  });

  it('an explicit pending request (non-null requestExpiresAt) is NOT eligible, whether or not it has lapsed', () => {
    const future = new Date('2099-01-01T13:00:00Z');
    const past = new Date('2000-01-01T00:00:00Z');

    expect(isReminderEligibleAppointment({ status: 'pending', requestExpiresAt: future })).toBe(false);
    expect(isReminderEligibleAppointment({ status: 'pending', requestExpiresAt: past })).toBe(false);
  });
});

// =============================================================================
// SQL FRAGMENT — differential proof against the pure predicate, over a real
// PGlite database.
// =============================================================================

describe('reminderEligibleAppointmentCondition (PGlite)', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const SALON_ID = 'salon_reminder_eligibility_test';

  const ROWS = [
    { id: 'appt_confirmed', status: 'confirmed', requestExpiresAt: null },
    { id: 'appt_pending_legacy', status: 'pending', requestExpiresAt: null },
    { id: 'appt_pending_explicit_future', status: 'pending', requestExpiresAt: new Date('2099-01-01T13:00:00Z') },
    { id: 'appt_pending_explicit_expired', status: 'pending', requestExpiresAt: new Date('2000-01-01T00:00:00Z') },
    { id: 'appt_in_progress', status: 'in_progress', requestExpiresAt: null },
    { id: 'appt_awaiting_payment', status: 'awaiting_payment', requestExpiresAt: null },
    { id: 'appt_cancelled', status: 'cancelled', requestExpiresAt: null },
    { id: 'appt_completed', status: 'completed', requestExpiresAt: null },
    { id: 'appt_no_show', status: 'no_show', requestExpiresAt: null },
  ] as const;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

    await db.insert(schema.salonSchema).values({ id: SALON_ID, name: 'Reminder Eligibility Salon', slug: 'reminder-eligibility-salon' });

    for (const row of ROWS) {
      const techId = `tech_${row.id}`;
      await db.insert(schema.technicianSchema).values({ id: techId, salonId: SALON_ID, name: techId });
      await db.insert(schema.appointmentSchema).values({
        id: row.id,
        salonId: SALON_ID,
        technicianId: techId,
        clientPhone: '4165550000',
        startTime: new Date('2099-01-01T09:00:00Z'),
        endTime: new Date('2099-01-01T10:00:00Z'),
        status: row.status,
        requestExpiresAt: row.requestExpiresAt,
        totalPrice: 5000,
        totalDurationMinutes: 60,
      });
    }
  });

  it('the SQL fragment selects exactly the rows the pure predicate says are eligible', async () => {
    const eligible = await db
      .select({ id: schema.appointmentSchema.id })
      .from(schema.appointmentSchema)
      .where(and(eq(schema.appointmentSchema.salonId, SALON_ID), reminderEligibleAppointmentCondition()));

    const actualEligibleIds = new Set(eligible.map(row => row.id));
    const expectedEligibleIds = new Set(
      ROWS.filter(row => isReminderEligibleAppointment(row)).map(row => row.id),
    );

    expect(actualEligibleIds).toEqual(expectedEligibleIds);
    // Non-vacuous: prove the set is neither "everything" nor "nothing".
    expect(actualEligibleIds.size).toBeGreaterThan(0);
    expect(actualEligibleIds.size).toBeLessThan(ROWS.length);
    // Anchor the specific rows this test exists to pin.
    expect(actualEligibleIds.has('appt_confirmed')).toBe(true);
    expect(actualEligibleIds.has('appt_pending_legacy')).toBe(true);
    expect(actualEligibleIds.has('appt_pending_explicit_future')).toBe(false);
    expect(actualEligibleIds.has('appt_pending_explicit_expired')).toBe(false);
    expect(actualEligibleIds.has('appt_awaiting_payment')).toBe(false);
    expect(actualEligibleIds.has('appt_cancelled')).toBe(false);
  });
});

// =============================================================================
// STRUCTURAL DRIFT — the one known call site must consume
// reminderEligibleAppointmentCondition() / isReminderEligibleAppointment(),
// never re-derive a bare inArray(status, ['pending', 'confirmed']).
// =============================================================================

describe('structural call-site drift', () => {
  const KNOWN_CALL_SITES = ['src/libs/appointmentReminders.ts'];

  const files = readSourceFiles(KNOWN_CALL_SITES);
  const fileExists = (candidate: string) => files.has(candidate) || candidate === 'src/libs/reminderEligibility.ts';

  it('the bare-membership pattern is actually detectable (non-vacuous)', () => {
    const BARE_PATTERN = /inArray\(\s*appointmentSchema\.status\s*,\s*\[\s*['"]pending['"]\s*,\s*['"]confirmed['"]\s*\]\s*\)/;

    expect(BARE_PATTERN.test('inArray(appointmentSchema.status, [\'pending\', \'confirmed\'])')).toBe(true);
  });

  it('appointmentReminders.ts imports reminderEligibleAppointmentCondition / isReminderEligibleAppointment from reminderEligibility.ts', () => {
    const offenders: string[] = [];
    for (const file of KNOWN_CALL_SITES) {
      const source = files.get(file)!;
      const importsHelper = getValueImportSpecifiers(source, file).some((specifier) => {
        const resolved = resolveModuleSpecifier(file, specifier, fileExists);
        return resolved === 'src/libs/reminderEligibility.ts';
      });
      if (!importsHelper) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('appointmentReminders.ts never re-derives a bare inArray(status, [\'pending\', \'confirmed\']) predicate', () => {
    const BARE_PATTERN = /inArray\(\s*appointmentSchema\.status\s*,\s*\[\s*['"]pending['"]\s*,\s*['"]confirmed['"]\s*\]\s*\)/;
    const offenders = KNOWN_CALL_SITES.filter(file => BARE_PATTERN.test(stripComments(files.get(file)!)));

    expect(offenders).toEqual([]);
  });

  it('appointmentReminders.ts uses the shared predicate at all three known call sites (query, freshness re-check, markReminderSent CAS)', () => {
    const source = stripComments(files.get('src/libs/appointmentReminders.ts')!);
    const queryUsages = source.match(/reminderEligibleAppointmentCondition\(\)/g) ?? [];
    const inMemoryUsages = source.match(/isReminderEligibleAppointment\(/g) ?? [];

    // Two SQL-fragment call sites (loadReminderCandidates's query,
    // markReminderSent's day-before AND same-day CAS branches = 3 total, but
    // the query itself is one more) plus one in-memory call site
    // (isCurrentReminderCandidate). Asserts >= rather than an exact count so
    // this does not become a brittle line-count pin.
    expect(queryUsages.length).toBeGreaterThanOrEqual(3);
    expect(inMemoryUsages.length).toBeGreaterThanOrEqual(1);
  });
});
