import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  eraseNetworkNoShowSubjectInTx,
  readNetworkNoShowRisk,
  reconcileNetworkNoShows,
  recordNetworkNoShowInTx,
  registerNetworkBookingInTx,
  suppressNetworkNoShowSubjectInTx,
} from '@/libs/networkNoShow.server';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;
const now = new Date('2030-06-15T16:00:00.000Z');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 30_000);

beforeEach(async () => {
  process.env.NETWORK_NO_SHOW_ENABLED = 'true';
  process.env.NETWORK_NO_SHOW_HMAC_KEY = 'test-network-no-show-hmac-key-at-least-32-chars';
  // Each case owns its clock and source records, including expiry boundaries.
  await db.execute(sql`TRUNCATE network_no_show_platform_control, network_no_show_subject, salon CASCADE`);
});

afterAll(async () => client.close());

async function participant(salonId: string) {
  await db.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: salonId });
  await db.insert(schema.networkNoShowPlatformControlSchema).values({
    id: 1,
    enabledAt: new Date('2030-01-01T00:00:00.000Z'),
    prospectiveAfter: new Date('2030-01-01T00:00:00.000Z'),
  }).onConflictDoUpdate({
    target: schema.networkNoShowPlatformControlSchema.id,
    set: { enabledAt: new Date('2030-01-01T00:00:00.000Z'), prospectiveAfter: new Date('2030-01-01T00:00:00.000Z') },
  });
}

async function booking(input: { salonId: string; phone?: string; email?: string; status?: string; actorRole?: 'guest' | 'client' | 'admin' | 'staff'; startTime?: Date; endTime?: Date; createdAt?: Date }) {
  sequence += 1;
  const id = `network-appt-${sequence}`;
  const phone = input.phone ?? `416555${String(1000 + sequence).padStart(4, '0')}`;
  const email = input.email ?? `customer-${sequence}@example.com`;
  const endTime = input.endTime ?? new Date('2030-06-15T15:00:00.000Z');
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: input.salonId,
    clientPhone: phone,
    clientEmail: email,
    startTime: input.startTime ?? new Date('2030-06-15T14:00:00.000Z'),
    endTime,
    status: input.status ?? 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
    createdAt: input.createdAt ?? new Date('2030-06-01T00:00:00.000Z'),
  });
  await db.transaction(tx => registerNetworkBookingInTx(tx, {
    salonId: input.salonId,
    appointmentId: id,
    phone,
    email,
    actorRole: input.actorRole ?? 'guest',
    now,
  }));
  return { id, phone, email };
}

describe('network no-show storage', () => {
  it('is dark without the platform gate', async () => {
    process.env.NETWORK_NO_SHOW_ENABLED = 'false';

    await expect(readNetworkNoShowRisk({ salonId: 'missing', phone: '4165551000', email: 'customer@example.com' })).resolves.toEqual({ state: 'inactive' });
  });

  it('records one source event and revokes it immediately on correction', async () => {
    const source = `network-source-${sequence}`;
    const receiver = `network-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const entry = await booking({ salonId: source, status: 'no_show' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'owner-1', actorRole: 'owner', now }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email })).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });

    await db.update(schema.appointmentSchema).set({ status: 'completed' })
      .where(and(eq(schema.appointmentSchema.salonId, source), eq(schema.appointmentSchema.id, entry.id)));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email })).resolves.toEqual({ state: 'available', activeNoShowCount: 0, windowMonths: 12 });
    expect((await db.select().from(schema.networkNoShowBookingBindingSchema)
      .where(and(eq(schema.networkNoShowBookingBindingSchema.salonId, source), eq(schema.networkNoShowBookingBindingSchema.appointmentId, entry.id))))[0]?.state).toBe('eligible');

    await db.update(schema.appointmentSchema).set({ status: 'no_show' }).where(eq(schema.appointmentSchema.id, entry.id));

    expect((await db.select().from(schema.networkNoShowEventSchema)
      .where(eq(schema.networkNoShowEventSchema.appointmentId, entry.id)))[0]?.state).toBe('revoked');
  });

  it('does not match a phone-only collision and suppresses an edited binding before no-show', async () => {
    const source = `network-contact-${sequence}`;
    const receiver = `network-contact-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const entry = await booking({ salonId: source });
    await db.update(schema.appointmentSchema).set({ clientEmail: 'changed@example.com' })
      .where(eq(schema.appointmentSchema.id, entry.id));
    await db.update(schema.appointmentSchema).set({ status: 'no_show' }).where(eq(schema.appointmentSchema.id, entry.id));
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'owner-1', actorRole: 'owner', now }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email })).resolves.toEqual({ state: 'available', activeNoShowCount: 0, windowMonths: 12 });
    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: 'other@example.com' })).resolves.toEqual({ state: 'unavailable' });
  });

  it('does not bind owner-created appointments and withdraws a disabled source contribution', async () => {
    const source = `network-owner-${sequence}`;
    const receiver = `network-owner-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const ownerEntry = await booking({ salonId: source, status: 'no_show', actorRole: 'admin' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: ownerEntry.id, actorId: 'owner-1', actorRole: 'owner', now }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: ownerEntry.phone, email: ownerEntry.email })).resolves.toEqual({ state: 'unavailable' });

    const guestEntry = await booking({ salonId: source, status: 'no_show' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: guestEntry.id, actorId: 'owner-1', actorRole: 'owner', now }));
    await db.update(schema.networkNoShowPlatformControlSchema).set({ enabledAt: null }).where(eq(schema.networkNoShowPlatformControlSchema.id, 1));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: guestEntry.phone, email: guestEntry.email })).resolves.toEqual({ state: 'inactive' });
  });

  it('suppresses a binding when a projected appointment is rescheduled', async () => {
    const source = `network-schedule-${sequence}`;
    await participant(source);
    const entry = await booking({ salonId: source, status: 'no_show' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'owner-1', actorRole: 'owner', now }));
    await db.update(schema.appointmentSchema).set({ startTime: new Date('2030-06-16T14:00:00.000Z') })
      .where(eq(schema.appointmentSchema.id, entry.id));

    expect((await db.select().from(schema.networkNoShowBookingBindingSchema)
      .where(eq(schema.networkNoShowBookingBindingSchema.appointmentId, entry.id)))[0]?.state).toBe('suppressed');
  });

  it('suppresses and erases a subject without exposing source data', async () => {
    const source = `network-erase-${sequence}`;
    const receiver = `network-erase-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const entry = await booking({ salonId: source, status: 'no_show', email: `erase-${sequence}@example.com` });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'owner-1', actorRole: 'owner', now }));
    const [binding] = await db.select().from(schema.networkNoShowBookingBindingSchema)
      .where(and(eq(schema.networkNoShowBookingBindingSchema.salonId, source), eq(schema.networkNoShowBookingBindingSchema.appointmentId, entry.id)));

    expect(binding?.subjectId).toBeTruthy();

    if (!binding?.subjectId) {
      throw new Error('Expected an eligible subject binding');
    }

    const subjectId = binding.subjectId;
    await db.transaction(tx => suppressNetworkNoShowSubjectInTx(tx, { subjectId, operatorId: 'operator-1', now, reason: 'shared_contact' }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email })).resolves.toEqual({ state: 'unavailable' });

    await db.transaction(tx => eraseNetworkNoShowSubjectInTx(tx, { subjectId, operatorId: 'operator-1', now }));

    expect(await db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.subjectId, subjectId))).toHaveLength(0);
  });

  it('counts separate appointments once each, corrects while dark, and expires at the exact anniversary', async () => {
    const sourceA = `network-count-a-${sequence}`;
    const sourceC = `network-count-c-${sequence}`;
    const receiver = `network-count-b-${sequence}`;
    await participant(sourceA);
    await participant(sourceC);
    await participant(receiver);
    const first = await booking({ salonId: sourceA, status: 'no_show' });
    const second = await booking({ salonId: sourceC, status: 'no_show', phone: first.phone, email: first.email });
    const mark = (salonId: string, appointmentId: string) => db.transaction(tx => recordNetworkNoShowInTx(tx, {
      salonId,
      appointmentId,
      actorId: 'owner-count',
      actorRole: 'owner',
      now,
    }));
    await mark(sourceA, first.id);
    await mark(sourceA, first.id);
    await mark(sourceC, second.id);
    const read = (at: Date) => readNetworkNoShowRisk({ salonId: receiver, phone: first.phone, email: first.email, now: at });

    await expect(read(now)).resolves.toEqual({ state: 'available', activeNoShowCount: 2, windowMonths: 12 });

    process.env.NETWORK_NO_SHOW_ENABLED = 'false';
    await db.update(schema.appointmentSchema).set({ status: 'completed' }).where(eq(schema.appointmentSchema.id, first.id));
    process.env.NETWORK_NO_SHOW_ENABLED = 'true';

    await expect(read(now)).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });
    await expect(read(new Date('2031-06-15T14:59:59.999Z'))).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });
    await expect(read(new Date('2031-06-15T15:00:00.000Z'))).resolves.toEqual({ state: 'available', activeNoShowCount: 0, windowMonths: 12 });
    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: '4165559999', email: first.email, now })).resolves.toEqual({ state: 'unavailable' });
    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: first.phone, email: null, now })).resolves.toEqual({ state: 'unavailable' });
  });

  it('does not register pre-participation appointments', async () => {
    const source = `network-prospective-${sequence}`;
    const receiver = `network-prospective-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    await db.update(schema.networkNoShowPlatformControlSchema).set({ prospectiveAfter: now }).where(eq(schema.networkNoShowPlatformControlSchema.id, 1));
    const old = await booking({ salonId: source, status: 'no_show' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, {
      salonId: source,
      appointmentId: old.id,
      actorId: 'owner-old',
      actorRole: 'owner',
      now,
    }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: old.phone, email: old.email, now })).resolves.toEqual({ state: 'unavailable' });
  });

  it.each(['2030-06-15T13:00:00.000Z', '2030-06-15T14:30:00.000Z'])('counts an explicit mark immediately at %s, only once, and revokes a correction', async (at) => {
    const source = `network-early-reconcile-${sequence}`;
    const receiver = `network-early-reconcile-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const entry = await booking({ salonId: source });
    const markedAt = new Date(at);
    await db.update(schema.appointmentSchema).set({ status: 'no_show' }).where(eq(schema.appointmentSchema.id, entry.id));

    await expect(db.transaction(tx => recordNetworkNoShowInTx(tx, {
      salonId: source,
      appointmentId: entry.id,
      actorId: 'owner-early',
      actorRole: 'admin',
      now: markedAt,
    }))).resolves.toBe(true);

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email, now: markedAt })).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });
    await expect(db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'duplicate-owner', actorRole: 'admin', now: markedAt }))).resolves.toBe(false);
    await expect(reconcileNetworkNoShows({ handle: db, now: markedAt })).resolves.toEqual({ scanned: 0, recorded: 0 });

    const eventsAfterFirstSweep = await db.select().from(schema.networkNoShowEventSchema)
      .where(eq(schema.networkNoShowEventSchema.appointmentId, entry.id));
    await reconcileNetworkNoShows({ handle: db, now });

    await expect(db.select().from(schema.networkNoShowEventSchema)
      .where(eq(schema.networkNoShowEventSchema.appointmentId, entry.id))).resolves.toEqual(eventsAfterFirstSweep);
    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email, now })).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });

    const [event] = await db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, entry.id));

    expect(event).toMatchObject({ markedBy: 'owner-early', markedByRole: 'admin', markedAt });

    await db.update(schema.appointmentSchema).set({ status: 'cancelled' }).where(eq(schema.appointmentSchema.id, entry.id));
    await reconcileNetworkNoShows({ handle: db, now });

    expect((await db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.id, event!.id)))[0]?.state).toBe('revoked');
    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email, now: markedAt })).resolves.toEqual({ state: 'available', activeNoShowCount: 0, windowMonths: 12 });
  });

  it('recovers an existing pending mark before the scheduled start with its original provenance', async () => {
    const source = `network-pending-${sequence}`;
    const receiver = `network-pending-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const entry = await booking({ salonId: source, status: 'no_show' });
    const markedAt = new Date('2030-06-15T12:00:00.000Z');
    const sweepAt = new Date('2030-06-15T13:00:00.000Z');
    await db.insert(schema.networkNoShowAuditSchema).values({ id: `pending-${entry.id}`, salonId: source, actorId: 'original-owner', actorRole: 'admin', action: `pending_no_show:${entry.id}`, createdAt: markedAt });

    await expect(reconcileNetworkNoShows({ handle: db, now: sweepAt })).resolves.toEqual({ scanned: 1, recorded: 1 });
    await expect(reconcileNetworkNoShows({ handle: db, now: sweepAt })).resolves.toEqual({ scanned: 0, recorded: 0 });
    expect((await db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, entry.id)))[0]).toMatchObject({ markedBy: 'original-owner', markedByRole: 'admin', markedAt });
    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email, now: sweepAt })).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });
  });

  it('accepts reports after seven days without extending their original expiry', async () => {
    const source = `network-late-${sequence}`;
    await participant(source);
    const entry = await booking({ salonId: source, status: 'no_show' });
    const markedAt = new Date('2030-07-01T16:00:00.000Z');

    await expect(db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'late-owner', actorRole: 'admin', now: markedAt }))).resolves.toBe(true);
    expect((await db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, entry.id)))[0]).toMatchObject({ markedAt, expiresAt: new Date('2031-06-15T15:00:00.000Z') });
  });

  it('rejects a new report at the exact twelve-month expiry', async () => {
    const source = `network-expired-report-${sequence}`;
    await participant(source);
    const entry = await booking({ salonId: source, status: 'no_show' });
    const expiredAt = new Date('2031-06-15T15:00:00.000Z');

    await expect(db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'late-owner', actorRole: 'admin', now: expiredAt }))).resolves.toBe(false);
    await expect(reconcileNetworkNoShows({ handle: db, now: expiredAt, limit: 1 })).resolves.toEqual({ scanned: 0, recorded: 0 });
  });

  it('uses the UTC leap-day anniversary in a non-UTC database session', async () => {
    const source = `network-leap-${sequence}`;
    await participant(source);
    const first = await booking({ salonId: source, status: 'no_show', createdAt: new Date('2032-02-01T00:00:00Z'), startTime: new Date('2032-02-29T23:00:00Z'), endTime: new Date('2032-02-29T23:30:00Z') });
    const boundary = await booking({ salonId: source, status: 'no_show', createdAt: new Date('2032-02-01T00:00:00Z'), startTime: new Date('2032-02-29T23:00:00Z'), endTime: new Date('2032-02-29T23:30:00Z') });
    await db.execute(sql`SET TIME ZONE 'Pacific/Auckland'`);
    try {
      await expect(reconcileNetworkNoShows({ handle: db, now: new Date('2033-02-28T23:29:59.999Z'), limit: 1 })).resolves.toEqual({ scanned: 1, recorded: 1 });
      expect((await db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, first.id)))[0]?.expiresAt).toEqual(new Date('2033-02-28T23:30:00Z'));
      await expect(reconcileNetworkNoShows({ handle: db, now: new Date('2033-02-28T23:30:00Z'), limit: 1 })).resolves.toEqual({ scanned: 0, recorded: 0 });
      await expect(db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, boundary.id))).resolves.toHaveLength(0);
    } finally {
      await db.execute(sql`SET TIME ZONE 'UTC'`);
    }
  });

  it('recovers only eligible unexpired records and labels legacy records with missing actor provenance', async () => {
    const source = `network-legacy-reconcile-${sequence}`;
    await participant(source);
    const legacy = await booking({ salonId: source, status: 'no_show' });
    const suppressed = await booking({ salonId: source, status: 'no_show' });
    const expired = await booking({ salonId: source, status: 'no_show', startTime: new Date('2030-06-14T14:00:00Z'), endTime: new Date('2030-06-14T15:00:00Z') });
    const sweepAt = new Date('2031-06-15T14:00:00Z');
    const createdAtStart = await booking({ salonId: source, status: 'no_show' });
    await db.update(schema.networkNoShowBookingBindingSchema).set({ state: 'suppressed', invalidatedAt: now })
      .where(eq(schema.networkNoShowBookingBindingSchema.appointmentId, suppressed.id));
    const deleted = await booking({ salonId: source, status: 'no_show' });
    await db.update(schema.appointmentSchema).set({ deletedAt: now }).where(eq(schema.appointmentSchema.id, deleted.id));
    await db.update(schema.appointmentSchema).set({ startTime: new Date('2030-06-01T00:00:00.000Z') })
      .where(eq(schema.appointmentSchema.id, createdAtStart.id));

    await expect(reconcileNetworkNoShows({ handle: db, now: sweepAt, limit: 1 })).resolves.toEqual({ scanned: 1, recorded: 1 });

    const [legacyEvent] = await db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, legacy.id));

    expect(legacyEvent).toMatchObject({ markedBy: 'system:network-no-show-reconcile', markedByRole: 'system', markedAt: sweepAt });
    await expect(db.select().from(schema.networkNoShowAuditSchema).where(eq(schema.networkNoShowAuditSchema.action, `reconciled:missing_source_actor:${legacy.id}`))).resolves.toHaveLength(1);

    await db.update(schema.appointmentSchema).set({ endTime: new Date('2030-06-01T15:00:00.000Z') }).where(eq(schema.appointmentSchema.id, suppressed.id));

    await expect(reconcileNetworkNoShows({ handle: db, now: sweepAt })).resolves.toEqual({ scanned: 0, recorded: 0 });
    await expect(db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, suppressed.id))).resolves.toHaveLength(0);
    await expect(db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, deleted.id))).resolves.toHaveLength(0);
    await expect(db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, expired.id))).resolves.toHaveLength(0);
    await expect(db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, createdAtStart.id))).resolves.toHaveLength(0);
  });

  it('never republishes an early no-show after its source was corrected before event creation', async () => {
    const source = `network-corrected-early-${sequence}`;
    await participant(source);
    const entry = await booking({ salonId: source });
    const early = new Date('2030-06-15T14:00:00.000Z');
    await db.update(schema.appointmentSchema).set({ status: 'no_show', cancelReason: 'no_show' })
      .where(eq(schema.appointmentSchema.id, entry.id));
    // Represents a pending mark created before immediate publication shipped.
    await db.insert(schema.networkNoShowAuditSchema).values({
      id: `pending-correction-${entry.id}`,
      salonId: source,
      actorId: 'owner-corrected-early',
      actorRole: 'admin',
      action: `pending_no_show:${entry.id}`,
      createdAt: early,
    });
    await db.update(schema.appointmentSchema).set({ status: 'cancelled', cancelReason: 'admin_correction' })
      .where(eq(schema.appointmentSchema.id, entry.id));
    await db.insert(schema.networkNoShowAuditSchema).values({
      id: `source-correction-${entry.id}`,
      salonId: source,
      actorId: 'operator',
      actorRole: 'operator',
      action: `source_corrected:no_show_to_cancelled:${entry.id}`,
    });
    // A stale status writer cannot turn the corrected source back into a
    // shared-risk event because the immutable correction audit fences it.
    await db.update(schema.appointmentSchema).set({ status: 'no_show', cancelReason: 'no_show' })
      .where(eq(schema.appointmentSchema.id, entry.id));

    await expect(reconcileNetworkNoShows({ handle: db, now })).resolves.toEqual({ scanned: 0, recorded: 0 });
    await expect(db.select().from(schema.networkNoShowEventSchema)
      .where(eq(schema.networkNoShowEventSchema.appointmentId, entry.id))).resolves.toHaveLength(0);
  });

  it('does not let an older durable-ineligible binding starve a later eligible record in a bounded batch', async () => {
    const source = `network-batch-reconcile-${sequence}`;
    await participant(source);
    const ineligible = await booking({ salonId: source, status: 'no_show' });
    const eligible = await booking({ salonId: source, status: 'no_show' });
    const [ineligibleBinding] = await db.select().from(schema.networkNoShowBookingBindingSchema)
      .where(eq(schema.networkNoShowBookingBindingSchema.appointmentId, ineligible.id));
    await db.update(schema.networkNoShowSubjectSchema).set({ state: 'suppressed' })
      .where(eq(schema.networkNoShowSubjectSchema.id, ineligibleBinding!.subjectId!));

    await expect(reconcileNetworkNoShows({ handle: db, limit: 1, now })).resolves.toEqual({ scanned: 1, recorded: 1 });
    await expect(db.select().from(schema.networkNoShowEventSchema)
      .where(eq(schema.networkNoShowEventSchema.appointmentId, eligible.id))).resolves.toHaveLength(1);
    await expect(db.select().from(schema.networkNoShowEventSchema)
      .where(eq(schema.networkNoShowEventSchema.appointmentId, ineligible.id))).resolves.toHaveLength(0);
  });
});
