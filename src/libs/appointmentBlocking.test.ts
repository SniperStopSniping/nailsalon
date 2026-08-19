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
// `bookingPolicy.ts` imports the real `@/libs/DB` singleton at module scope
// purely so it has a default `database` to fall back to; every test below
// passes its own PGlite instance explicitly via `database:`, so the real
// module is never touched. Mocking it here avoids the module's own
// `console.warn` fallback side effect (no DATABASE_URL in this sandbox),
// which `vitest-fail-on-console` would otherwise fail this suite for —
// mirrors the same guard `bookingPolicy.test.ts` already uses.
vi.mock('@/libs/DB', () => ({ db: {} }));

// eslint-disable-next-line import/first
import {
  BLOCKING_APPOINTMENT_STATUSES,
  blockingAppointmentCondition,
  isAppointmentBlockingSlot,
  isPendingRequestBlocking,
} from './appointmentBlocking';

/**
 * L1 PR4 — §16. Covers the pure predicate, the SQL fragment (against a real
 * PGlite database, differentially against the pure predicate), the two
 * production call sites that must consume it (`bookingConflictGuard.ts` /
 * `bookingPolicy.ts`), and a structural drift guard so a future edit that
 * reintroduces a bare `inArray(status, BLOCKING_APPOINTMENT_STATUSES)` at one
 * of the three known call sites fails the suite instead of silently
 * regressing.
 */

// =============================================================================
// PURE PREDICATE
// =============================================================================

describe('isPendingRequestBlocking', () => {
  const now = new Date('2099-01-01T12:00:00Z');

  it('a legacy pending row (NULL expiry) blocks indefinitely', () => {
    expect(isPendingRequestBlocking(null, now)).toBe(true);
    expect(isPendingRequestBlocking(null, new Date('2199-01-01T00:00:00Z'))).toBe(true);
  });

  it('an explicit pending row blocks strictly before its expiry', () => {
    const expiresAt = new Date('2099-01-01T13:00:00Z');

    expect(isPendingRequestBlocking(expiresAt, new Date('2099-01-01T12:59:59Z'))).toBe(true);
  });

  it('an explicit pending row does NOT block AT exactly its expiry instant', () => {
    const expiresAt = new Date('2099-01-01T13:00:00Z');

    expect(isPendingRequestBlocking(expiresAt, expiresAt)).toBe(false);
  });

  it('an explicit pending row does NOT block after its expiry', () => {
    const expiresAt = new Date('2099-01-01T13:00:00Z');

    expect(isPendingRequestBlocking(expiresAt, new Date('2099-01-01T13:00:01Z'))).toBe(false);
  });

  it('accepts an ISO string expiry (a row read back over raw SQL / JSON)', () => {
    expect(isPendingRequestBlocking('2099-01-01T13:00:00Z', new Date('2099-01-01T12:00:00Z'))).toBe(true);
    expect(isPendingRequestBlocking('2099-01-01T13:00:00Z', new Date('2099-01-01T14:00:00Z'))).toBe(false);
  });
});

describe('isAppointmentBlockingSlot', () => {
  const now = new Date('2099-01-01T12:00:00Z');

  it.each(['confirmed', 'in_progress', 'awaiting_payment'] as const)(
    '%s always blocks, regardless of requestExpiresAt',
    (status) => {
      expect(isAppointmentBlockingSlot({ status, requestExpiresAt: null }, now)).toBe(true);
      expect(
        isAppointmentBlockingSlot({ status, requestExpiresAt: new Date('2000-01-01T00:00:00Z') }, now),
      ).toBe(true);
    },
  );

  it.each(['cancelled', 'completed', 'no_show'] as const)(
    '%s never blocks',
    (status) => {
      expect(isAppointmentBlockingSlot({ status, requestExpiresAt: null }, now)).toBe(false);
    },
  );

  it('legacy pending (NULL expiry) blocks', () => {
    expect(isAppointmentBlockingSlot({ status: 'pending', requestExpiresAt: null }, now)).toBe(true);
  });

  it('explicit pending blocks only before its expiry', () => {
    const future = new Date('2099-01-01T13:00:00Z');
    const past = new Date('2099-01-01T11:00:00Z');

    expect(isAppointmentBlockingSlot({ status: 'pending', requestExpiresAt: future }, now)).toBe(true);
    expect(isAppointmentBlockingSlot({ status: 'pending', requestExpiresAt: past }, now)).toBe(false);
  });
});

// =============================================================================
// SQL FRAGMENT — differential proof against the pure predicate, over a real
// PGlite database (never the app's DB.ts singleton).
// =============================================================================

describe('blockingAppointmentCondition (PGlite)', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const SALON_ID = 'salon_blocking_test';
  const NOW = new Date('2099-01-01T12:00:00Z');

  const ROWS = [
    { id: 'appt_confirmed', status: 'confirmed', requestExpiresAt: null },
    { id: 'appt_in_progress', status: 'in_progress', requestExpiresAt: null },
    { id: 'appt_awaiting_payment', status: 'awaiting_payment', requestExpiresAt: null },
    { id: 'appt_pending_legacy', status: 'pending', requestExpiresAt: null },
    { id: 'appt_pending_future', status: 'pending', requestExpiresAt: new Date('2099-01-01T13:00:00Z') },
    { id: 'appt_pending_expired', status: 'pending', requestExpiresAt: new Date('2099-01-01T11:00:00Z') },
    { id: 'appt_pending_exact', status: 'pending', requestExpiresAt: NOW },
    { id: 'appt_cancelled', status: 'cancelled', requestExpiresAt: null },
    { id: 'appt_completed', status: 'completed', requestExpiresAt: null },
    { id: 'appt_no_show', status: 'no_show', requestExpiresAt: null },
  ] as const;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

    await db.insert(schema.salonSchema).values({ id: SALON_ID, name: 'Blocking Test Salon', slug: 'blocking-test-salon' });

    // Every row gets its OWN technician and its OWN slot: this test exercises
    // predicate MEMBERSHIP (does this row's status+expiry combination count
    // as blocking?), not the double-booking overlap logic — sharing a
    // technician/slot across several simultaneously-"active" statuses (by the
    // DB's own status-only backstop, which treats every 'pending' row as
    // active regardless of expiry) would trip
    // `appointment_tech_active_slot_unique` before this test ever ran.
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

  it('the SQL fragment selects exactly the rows the pure predicate says block, at the same instant', async () => {
    const blocking = await db
      .select({ id: schema.appointmentSchema.id })
      .from(schema.appointmentSchema)
      .where(and(eq(schema.appointmentSchema.salonId, SALON_ID), blockingAppointmentCondition(NOW)));

    const actualBlockingIds = new Set(blocking.map(row => row.id));
    const expectedBlockingIds = new Set(
      ROWS.filter(row => isAppointmentBlockingSlot(row, NOW)).map(row => row.id),
    );

    expect(actualBlockingIds).toEqual(expectedBlockingIds);
    // Non-vacuous: prove the set is neither "everything" nor "nothing", so
    // this assertion could actually have failed.
    expect(actualBlockingIds.size).toBeGreaterThan(0);
    expect(actualBlockingIds.size).toBeLessThan(ROWS.length);
    // Anchor the specific rows this test exists to pin.
    expect(actualBlockingIds.has('appt_pending_legacy')).toBe(true);
    expect(actualBlockingIds.has('appt_pending_future')).toBe(true);
    expect(actualBlockingIds.has('appt_pending_expired')).toBe(false);
    expect(actualBlockingIds.has('appt_pending_exact')).toBe(false);
    expect(actualBlockingIds.has('appt_awaiting_payment')).toBe(true);
    expect(actualBlockingIds.has('appt_cancelled')).toBe(false);
  });

  it('an expired explicit pending row does not need a sweep to stop blocking — moving `now` alone flips the result', async () => {
    const beforeExpiry = await db
      .select({ id: schema.appointmentSchema.id })
      .from(schema.appointmentSchema)
      .where(and(
        eq(schema.appointmentSchema.id, 'appt_pending_future'),
        blockingAppointmentCondition(new Date('2099-01-01T12:59:00Z')),
      ));
    const afterExpiry = await db
      .select({ id: schema.appointmentSchema.id })
      .from(schema.appointmentSchema)
      .where(and(
        eq(schema.appointmentSchema.id, 'appt_pending_future'),
        blockingAppointmentCondition(new Date('2099-01-01T13:00:01Z')),
      ));

    expect(beforeExpiry).toHaveLength(1);
    expect(afterExpiry).toHaveLength(0);
  });
});

// =============================================================================
// CALL-SITE INTEGRATION — bookingConflictGuard.ts / bookingPolicy.ts actually
// honour expiry, not merely the standalone SQL fragment.
// =============================================================================

describe('call-site integration', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const SALON_ID = 'salon_blocking_callsite';
  const TECH_ID = 'tech_blocking_callsite';

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

    await db.insert(schema.salonSchema).values({ id: SALON_ID, name: 'Callsite Salon', slug: 'callsite-salon' });
    await db.insert(schema.technicianSchema).values({ id: TECH_ID, salonId: SALON_ID, name: 'Callsite Tech' });
  });

  it('lockTechnicianAndAssertSlotFree lets a slot be rebooked once its explicit pending request has expired', async () => {
    const { lockTechnicianAndAssertSlotFree, SlotConflictError } = await import('./bookingConflictGuard');

    await db.insert(schema.appointmentSchema).values({
      id: 'appt_callsite_pending',
      salonId: SALON_ID,
      technicianId: TECH_ID,
      clientPhone: '4165550001',
      startTime: new Date('2099-02-01T10:00:00Z'),
      endTime: new Date('2099-02-01T11:00:00Z'),
      status: 'pending',
      requestExpiresAt: new Date('2099-02-01T09:30:00Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
    });

    // `now` is AFTER the request's expiry — must NOT block.
    await expect(
      db.transaction(tx =>
        lockTechnicianAndAssertSlotFree(tx, {
          salonId: SALON_ID,
          technicianId: TECH_ID,
          startTime: new Date('2099-02-01T10:00:00Z'),
          blockedEndTime: new Date('2099-02-01T11:00:00Z'),
          now: new Date('2099-02-01T09:45:00Z'),
        }),
      ),
    ).resolves.toBeUndefined();

    // `now` is BEFORE the request's expiry — must still block.
    await expect(
      db.transaction(tx =>
        lockTechnicianAndAssertSlotFree(tx, {
          salonId: SALON_ID,
          technicianId: TECH_ID,
          startTime: new Date('2099-02-01T10:00:00Z'),
          blockedEndTime: new Date('2099-02-01T11:00:00Z'),
          now: new Date('2099-02-01T09:00:00Z'),
        }),
      ),
    ).rejects.toBeInstanceOf(SlotConflictError);
  });

  it('lockTechnicianAndAssertSlotFree still blocks indefinitely on a legacy pending row with no default `now` supplied', async () => {
    const { lockTechnicianAndAssertSlotFree, SlotConflictError } = await import('./bookingConflictGuard');

    await db.insert(schema.appointmentSchema).values({
      id: 'appt_callsite_legacy_pending',
      salonId: SALON_ID,
      technicianId: TECH_ID,
      clientPhone: '4165550002',
      startTime: new Date('2099-03-01T10:00:00Z'),
      endTime: new Date('2099-03-01T11:00:00Z'),
      status: 'pending',
      requestExpiresAt: null,
      totalPrice: 5000,
      totalDurationMinutes: 60,
    });

    await expect(
      db.transaction(tx =>
        lockTechnicianAndAssertSlotFree(tx, {
          salonId: SALON_ID,
          technicianId: TECH_ID,
          startTime: new Date('2099-03-01T10:00:00Z'),
          blockedEndTime: new Date('2099-03-01T11:00:00Z'),
          // `now` intentionally omitted — must default and still block, since
          // a legacy (NULL expiry) pending row blocks regardless of `now`.
        }),
      ),
    ).rejects.toBeInstanceOf(SlotConflictError);
  });

  it('loadBookingPolicy excludes an expired explicit pending row from the returned occupancy map', async () => {
    const { loadBookingPolicy } = await import('./bookingPolicy');

    await db.insert(schema.appointmentSchema).values([
      {
        id: 'appt_policy_expired',
        salonId: SALON_ID,
        technicianId: TECH_ID,
        clientPhone: '4165550003',
        startTime: new Date('2099-04-01T10:00:00Z'),
        endTime: new Date('2099-04-01T11:00:00Z'),
        status: 'pending',
        requestExpiresAt: new Date('2099-04-01T09:30:00Z'),
        totalPrice: 5000,
        totalDurationMinutes: 60,
      },
      {
        id: 'appt_policy_still_pending',
        salonId: SALON_ID,
        technicianId: TECH_ID,
        clientPhone: '4165550004',
        startTime: new Date('2099-04-01T14:00:00Z'),
        endTime: new Date('2099-04-01T15:00:00Z'),
        status: 'pending',
        requestExpiresAt: new Date('2099-04-01T20:00:00Z'),
        totalPrice: 5000,
        totalDurationMinutes: 60,
      },
    ]);

    const policy = await loadBookingPolicy({
      salonId: SALON_ID,
      technicianIds: [TECH_ID],
      date: '2099-04-01',
      selectedDate: new Date('2099-04-01T00:00:00Z'),
      startOfDay: new Date('2099-04-01T00:00:00Z'),
      endOfDay: new Date('2099-04-02T00:00:00Z'),
      database: db,
      now: new Date('2099-04-01T10:00:00Z'),
    });

    const ids = (policy.appointmentsByTechnician.get(TECH_ID) ?? []).map(a => a.id);

    expect(ids).toContain('appt_policy_still_pending');
    expect(ids).not.toContain('appt_policy_expired');
  });
});

// =============================================================================
// STRUCTURAL DRIFT — the three known call sites must consume
// `blockingAppointmentCondition` (or `isAppointmentBlockingSlot`) from THIS
// module, never re-derive a bare `inArray(status, BLOCKING_APPOINTMENT_STATUSES)`.
// =============================================================================

describe('structural call-site drift', () => {
  const KNOWN_CALL_SITES = [
    'src/libs/bookingConflictGuard.ts',
    'src/libs/bookingPolicy.ts',
    'src/app/api/appointments/route.ts',
  ];

  const files = readSourceFiles(KNOWN_CALL_SITES);
  const fileExists = (candidate: string) => files.has(candidate) || candidate === 'src/libs/appointmentBlocking.ts';

  it('the bare-membership pattern is actually detectable (non-vacuous)', () => {
    const BARE_PATTERN = /inArray\(\s*appointmentSchema\.status\s*,\s*\[\.\.\.BLOCKING_APPOINTMENT_STATUSES\]\s*\)/;

    expect(BARE_PATTERN.test('inArray(appointmentSchema.status, [...BLOCKING_APPOINTMENT_STATUSES])')).toBe(true);
  });

  it('every known call site imports blockingAppointmentCondition (or isAppointmentBlockingSlot) from appointmentBlocking.ts', () => {
    const offenders: string[] = [];
    for (const file of KNOWN_CALL_SITES) {
      const source = files.get(file)!;
      const importsHelper = getValueImportSpecifiers(source, file).some((specifier) => {
        const resolved = resolveModuleSpecifier(file, specifier, fileExists);
        return resolved === 'src/libs/appointmentBlocking.ts';
      });
      if (!importsHelper) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('none of the known call sites re-derive a bare inArray(status, BLOCKING_APPOINTMENT_STATUSES) predicate', () => {
    const BARE_PATTERN = /inArray\(\s*appointmentSchema\.status\s*,\s*\[\.\.\.BLOCKING_APPOINTMENT_STATUSES\]\s*\)/;
    const offenders = KNOWN_CALL_SITES.filter(file => BARE_PATTERN.test(stripComments(files.get(file)!)));

    expect(offenders).toEqual([]);
  });
});

// =============================================================================
// The migration-pinned status list itself is unchanged in shape/name.
// =============================================================================

describe('BLOCKING_APPOINTMENT_STATUSES (re-exported)', () => {
  it('still contains exactly the four statuses the migrations recognize', () => {
    expect([...BLOCKING_APPOINTMENT_STATUSES].sort()).toEqual(
      ['awaiting_payment', 'confirmed', 'in_progress', 'pending'].sort(),
    );
  });
});
