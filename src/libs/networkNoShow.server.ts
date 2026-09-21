import 'server-only';

import { createHmac, randomUUID } from 'node:crypto';

import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import type { NetworkNoShowRisk, NoShowProtection } from '@/libs/networkNoShow';
import { normalizePhone } from '@/libs/phone';
import {
  appointmentSchema,
  networkNoShowAuditSchema,
  networkNoShowBookingBindingSchema,
  networkNoShowEventSchema,
  networkNoShowPlatformControlSchema,
  networkNoShowSubjectSchema,
} from '@/models/Schema';

/** A transaction or database handle accepted by the narrowly scoped projection. */
export type NetworkNoShowHandle = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const RESOLVER_VERSION = 'exact_contact_pair_v1';
const WINDOW_MONTHS = 12 as const;
const REPORTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type BookingChannel = 'guest' | 'client';

function isNetworkNoShowEnabled(): boolean {
  return process.env.NETWORK_NO_SHOW_ENABLED === 'true';
}

function requirePairKey(): string {
  const key = process.env.NETWORK_NO_SHOW_HMAC_KEY;
  if (!key || key.length < 32) {
    throw new Error('NETWORK_NO_SHOW_HMAC_KEY must contain at least 32 characters when network no-show protection is enabled');
  }
  return key;
}

function normalizeExactPair(phone: string | null | undefined, email: string | null | undefined): string | null {
  const normalizedPhone = normalizePhone(phone ?? '');
  const normalizedEmail = (email ?? '').trim().toLowerCase();
  // This deliberately mirrors the stored public-booking normalization: only
  // trim/lowercase; no provider-specific dot or plus-address rewriting.
  if (normalizedPhone.length !== 10 || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(normalizedEmail)) {
    return null;
  }
  return `${normalizedPhone}\u0000${normalizedEmail}`;
}

function pairHmac(pair: string): string {
  return createHmac('sha256', requirePairKey()).update(pair).digest('base64url');
}

function expiresAfterTwelveCalendarMonths(occurredAt: Date): Date {
  const result = new Date(occurredAt);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + WINDOW_MONTHS);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

async function resolveHandle(handle?: NetworkNoShowHandle): Promise<NetworkNoShowHandle> {
  if (handle) {
    return handle;
  }
  const { db: importedDb } = await import('@/libs/DB');
  return importedDb;
}

/**
 * The subject row is the serialization point for event publication, correction,
 * suppression and erasure. Callers hold it until their surrounding transaction
 * ends, so a stale active read cannot race a later tombstone.
 */
async function lockNetworkNoShowSubjectInTx(tx: NetworkNoShowHandle, subjectId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM network_no_show_subject WHERE id = ${subjectId} FOR UPDATE`);
}

async function lockPlatformControlInTx(tx: NetworkNoShowHandle): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT id FROM network_no_show_platform_control WHERE id = 1 AND enabled_at IS NOT NULL AND prospective_after IS NOT NULL FOR SHARE`);
  return rows.rows.length === 1;
}

export async function isNetworkNoShowPlatformActive(
  handle?: NetworkNoShowHandle,
): Promise<boolean> {
  if (!isNetworkNoShowEnabled()) {
    return false;
  }
  const database = await resolveHandle(handle);
  const [row] = await database.select({ id: networkNoShowPlatformControlSchema.id })
    .from(networkNoShowPlatformControlSchema)
    .where(and(
      eq(networkNoShowPlatformControlSchema.id, 1),
      isNotNull(networkNoShowPlatformControlSchema.enabledAt),
      isNotNull(networkNoShowPlatformControlSchema.prospectiveAfter),
    ))
    .limit(1);
  return Boolean(row);
}

export async function isNetworkNoShowPlatformActiveInTx(tx: NetworkNoShowHandle): Promise<boolean> {
  if (!isNetworkNoShowEnabled()) {
    return false;
  }
  return lockPlatformControlInTx(tx);
}

/**
 * Read the sole permitted cross-salon value. Callers must establish a local
 * booking/client relationship before calling; this function is not a lookup API.
 */
export async function readNetworkNoShowRisk(args: {
  salonId: string;
  phone: string | null | undefined;
  email: string | null | undefined;
  handle?: NetworkNoShowHandle;
  now?: Date;
}): Promise<NetworkNoShowRisk> {
  if (!isNetworkNoShowEnabled()) {
    return { state: 'inactive' };
  }
  if (!args.handle) {
    const { db: importedDb } = await import('@/libs/DB');
    return importedDb.transaction(tx => readNetworkNoShowRisk({ ...args, handle: tx }));
  }
  const database = await resolveHandle(args.handle);
  // Keep the global platform-control fence ahead of the subject lock.
  // A booking transaction invokes register later; disable uses this same order.
  if (!await lockPlatformControlInTx(database)) {
    return { state: 'inactive' };
  }

  const pair = normalizeExactPair(args.phone, args.email);
  if (!pair) {
    return { state: 'unavailable' };
  }
  const [subject] = await database.select({ id: networkNoShowSubjectSchema.id, state: networkNoShowSubjectSchema.state })
    .from(networkNoShowSubjectSchema)
    .where(and(
      eq(networkNoShowSubjectSchema.pairHmac, pairHmac(pair)),
      eq(networkNoShowSubjectSchema.resolverVersion, RESOLVER_VERSION),
    ))
    .limit(1);
  if (!subject || subject.state !== 'active') {
    return { state: 'unavailable' };
  }
  await lockNetworkNoShowSubjectInTx(database, subject.id);
  const [lockedSubject] = await database.select({ state: networkNoShowSubjectSchema.state })
    .from(networkNoShowSubjectSchema).where(eq(networkNoShowSubjectSchema.id, subject.id)).limit(1);
  if (!lockedSubject || lockedSubject.state !== 'active') {
    return { state: 'unavailable' };
  }

  const now = args.now ?? new Date();
  const [count] = await database.select({ count: sql<number>`count(*)::int` })
    .from(networkNoShowEventSchema)
    .where(and(
      eq(networkNoShowEventSchema.subjectId, subject.id),
      eq(networkNoShowEventSchema.state, 'active'),
      gt(networkNoShowEventSchema.expiresAt, now),
    ));
  return { state: 'available', activeNoShowCount: count?.count ?? 0, windowMonths: WINDOW_MONTHS };
}

/** Snapshot V1 contact-pair eligibility at creation. Owner/staff bookings are intentionally unsupported. */
export async function registerNetworkBookingInTx(
  tx: NetworkNoShowHandle,
  args: {
    salonId: string;
    appointmentId: string;
    phone: string | null | undefined;
    email: string | null | undefined;
    actorRole: BookingChannel | 'admin' | 'staff';
    now: Date;
    decision?: { protection: NoShowProtection; riskRequired: boolean; policyVersion: 1 };
  },
): Promise<void> {
  if (!isNetworkNoShowEnabled()) {
    return;
  }
  if (args.actorRole !== 'guest' && args.actorRole !== 'client') {
    return;
  }
  if (!await lockPlatformControlInTx(tx)) {
    return;
  }

  const [appointment] = await tx.select({
    createdAt: appointmentSchema.createdAt,
    startTime: appointmentSchema.startTime,
    clientPhone: appointmentSchema.clientPhone,
    clientEmail: appointmentSchema.clientEmail,
  })
    .from(appointmentSchema)
    .where(and(eq(appointmentSchema.salonId, args.salonId), eq(appointmentSchema.id, args.appointmentId)))
    .limit(1);
  // A source appointment must have existed before its scheduled start; this
  // blocks retroactive owner-created records from becoming a network event.
  const [control] = await tx.select().from(networkNoShowPlatformControlSchema).where(eq(networkNoShowPlatformControlSchema.id, 1)).limit(1);
  if (!control?.prospectiveAfter || !appointment || appointment.createdAt < control.prospectiveAfter || appointment.createdAt >= appointment.startTime) {
    return;
  }

  const pair = normalizeExactPair(args.phone, args.email);
  const authoritativePair = normalizeExactPair(appointment.clientPhone, appointment.clientEmail);
  // The binding always derives from the persisted source appointment. A caller
  // cannot attach a request contact pair that differs from what was booked.
  const eligiblePair = pair && pair === authoritativePair ? pair : null;
  if (!eligiblePair) {
    await tx.insert(networkNoShowBookingBindingSchema).values({
      id: randomUUID(),
      salonId: args.salonId,
      appointmentId: args.appointmentId,
      resolverVersion: RESOLVER_VERSION,
      state: 'unavailable',
      bookingChannel: args.actorRole,
      createdAt: args.now,
      decisionSnapshot: args.decision,
    }).onConflictDoNothing();
    return;
  }

  const hmac = pairHmac(eligiblePair);
  const [existing] = await tx.select().from(networkNoShowSubjectSchema)
    .where(and(eq(networkNoShowSubjectSchema.pairHmac, hmac), eq(networkNoShowSubjectSchema.resolverVersion, RESOLVER_VERSION)))
    .limit(1);
  const subjectId = existing?.id ?? randomUUID();
  if (!existing) {
    await tx.insert(networkNoShowSubjectSchema)
      .values({ id: subjectId, pairHmac: hmac, resolverVersion: RESOLVER_VERSION })
      .onConflictDoNothing();
  }
  const [resolvedSubject] = existing
    ? [existing]
    : await tx.select().from(networkNoShowSubjectSchema)
      .where(and(eq(networkNoShowSubjectSchema.pairHmac, hmac), eq(networkNoShowSubjectSchema.resolverVersion, RESOLVER_VERSION)))
      .limit(1);
  if (!resolvedSubject) {
    throw new Error('Network no-show subject could not be resolved');
  }
  await lockNetworkNoShowSubjectInTx(tx, resolvedSubject.id);
  const [lockedSubject] = await tx.select({ state: networkNoShowSubjectSchema.state })
    .from(networkNoShowSubjectSchema).where(eq(networkNoShowSubjectSchema.id, resolvedSubject.id)).limit(1);
  if (!lockedSubject || lockedSubject.state !== 'active') {
    await tx.insert(networkNoShowBookingBindingSchema).values({
      id: randomUUID(),
      salonId: args.salonId,
      appointmentId: args.appointmentId,
      resolverVersion: RESOLVER_VERSION,
      state: 'suppressed',
      bookingChannel: args.actorRole,
      createdAt: args.now,
      decisionSnapshot: args.decision,
    }).onConflictDoNothing();
    return;
  }
  await tx.insert(networkNoShowBookingBindingSchema).values({
    id: randomUUID(),
    salonId: args.salonId,
    appointmentId: args.appointmentId,
    subjectId: resolvedSubject.id,
    resolverVersion: RESOLVER_VERSION,
    state: resolvedSubject.state === 'active' ? 'eligible' : 'suppressed',
    bookingChannel: args.actorRole,
    createdAt: args.now,
    decisionSnapshot: args.decision,
  }).onConflictDoNothing();
}

/** Creates one event at most, from the immutable booking binding. */
export async function recordNetworkNoShowInTx(
  tx: NetworkNoShowHandle,
  args: { salonId: string; appointmentId: string; actorId: string; actorRole: string; now: Date },
): Promise<void> {
  if (!isNetworkNoShowEnabled()) {
    return;
  }
  if (!await lockPlatformControlInTx(tx)) {
    return;
  }
  const [appointment] = await tx.select({ id: appointmentSchema.id, status: appointmentSchema.status, createdAt: appointmentSchema.createdAt, endTime: appointmentSchema.endTime, deletedAt: appointmentSchema.deletedAt })
    .from(appointmentSchema).where(and(eq(appointmentSchema.salonId, args.salonId), eq(appointmentSchema.id, args.appointmentId))).limit(1);
  const [binding] = await tx.select().from(networkNoShowBookingBindingSchema)
    .where(and(eq(networkNoShowBookingBindingSchema.salonId, args.salonId), eq(networkNoShowBookingBindingSchema.appointmentId, args.appointmentId))).limit(1);
  const [subject] = binding?.subjectId
    ? await tx.select({ state: networkNoShowSubjectSchema.state }).from(networkNoShowSubjectSchema)
      .where(eq(networkNoShowSubjectSchema.id, binding.subjectId)).limit(1)
    : [];
  const [control] = await tx.select().from(networkNoShowPlatformControlSchema).where(eq(networkNoShowPlatformControlSchema.id, 1)).limit(1);
  if (!control?.prospectiveAfter || !appointment || !binding || !subject || subject.state !== 'active' || appointment.status !== 'no_show' || appointment.deletedAt || binding.state !== 'eligible' || !binding.subjectId
    || appointment.createdAt < control.prospectiveAfter || args.now < appointment.endTime || args.now.getTime() - appointment.endTime.getTime() > REPORTING_WINDOW_MS) {
    return;
  }
  await lockNetworkNoShowSubjectInTx(tx, binding.subjectId);
  const [lockedSubject] = await tx.select({ state: networkNoShowSubjectSchema.state })
    .from(networkNoShowSubjectSchema).where(eq(networkNoShowSubjectSchema.id, binding.subjectId)).limit(1);
  if (!lockedSubject || lockedSubject.state !== 'active') {
    return;
  }
  const eventId = randomUUID();
  const inserted = await tx.insert(networkNoShowEventSchema).values({
    id: eventId,
    salonId: args.salonId,
    appointmentId: args.appointmentId,
    subjectId: binding.subjectId,
    occurredAt: appointment.endTime,
    expiresAt: expiresAfterTwelveCalendarMonths(appointment.endTime),
    markedBy: args.actorId,
    markedByRole: args.actorRole,
    markedAt: args.now,
  }).onConflictDoNothing().returning();
  if (!inserted[0]) {
    return;
  }
  await tx.insert(networkNoShowAuditSchema).values({ id: randomUUID(), salonId: args.salonId, eventId, actorId: args.actorId, actorRole: args.actorRole, action: 'recorded' });
}

export async function suppressNetworkNoShowEventInTx(
  tx: NetworkNoShowHandle,
  args: { eventId: string; operatorId: string; now: Date; reason: 'identity_dispute' | 'accuracy_dispute' },
): Promise<void> {
  const [event] = await tx.select({ subjectId: networkNoShowEventSchema.subjectId })
    .from(networkNoShowEventSchema).where(eq(networkNoShowEventSchema.id, args.eventId)).limit(1);
  if (!event) {
    return;
  }
  await lockNetworkNoShowSubjectInTx(tx, event.subjectId);
  await tx.update(networkNoShowEventSchema).set({ state: 'suppressed', revokedAt: args.now, suppressionReason: args.reason })
    .where(eq(networkNoShowEventSchema.id, args.eventId));
  await tx.insert(networkNoShowAuditSchema).values({ id: randomUUID(), eventId: args.eventId, actorId: args.operatorId, actorRole: 'operator', action: `suppressed:${args.reason}` });
}

/** Operator-only identity resolution. It removes a pair from every risk decision. */
export async function suppressNetworkNoShowSubjectInTx(
  tx: NetworkNoShowHandle,
  args: { subjectId: string; operatorId: string; now: Date; reason: 'shared_contact' | 'recycled_contact' | 'identity_conflict' },
): Promise<void> {
  await lockNetworkNoShowSubjectInTx(tx, args.subjectId);
  await tx.update(networkNoShowSubjectSchema).set({ state: 'suppressed', updatedAt: args.now })
    .where(eq(networkNoShowSubjectSchema.id, args.subjectId));
  await tx.update(networkNoShowEventSchema).set({ state: 'suppressed', revokedAt: args.now, suppressionReason: args.reason })
    .where(and(eq(networkNoShowEventSchema.subjectId, args.subjectId), eq(networkNoShowEventSchema.state, 'active')));
  await tx.update(networkNoShowBookingBindingSchema).set({ state: 'suppressed', invalidatedAt: args.now })
    .where(and(eq(networkNoShowBookingBindingSchema.subjectId, args.subjectId), eq(networkNoShowBookingBindingSchema.state, 'eligible')));
  await tx.insert(networkNoShowAuditSchema).values({
    id: randomUUID(),
    actorId: args.operatorId,
    actorRole: 'operator',
    action: `subject_suppressed:${args.reason}`,
  });
}

/**
 * Tombstones a subject for an erasure request. The pair HMAC remains only to
 * prevent delayed writes or queued replay from recreating cross-salon history.
 */
export async function eraseNetworkNoShowSubjectInTx(
  tx: NetworkNoShowHandle,
  args: { subjectId: string; operatorId: string; now: Date },
): Promise<void> {
  await lockNetworkNoShowSubjectInTx(tx, args.subjectId);
  await tx.update(networkNoShowSubjectSchema).set({ state: 'erased', updatedAt: args.now })
    .where(eq(networkNoShowSubjectSchema.id, args.subjectId));
  // Event/binding rows are deleted. The subject's erased state and pair HMAC
  // are the replay fence; a delayed outbox/status write cannot recreate it.
  await tx.delete(networkNoShowEventSchema).where(eq(networkNoShowEventSchema.subjectId, args.subjectId));
  await tx.delete(networkNoShowBookingBindingSchema).where(eq(networkNoShowBookingBindingSchema.subjectId, args.subjectId));
  await tx.insert(networkNoShowAuditSchema).values({
    id: randomUUID(),
    actorId: args.operatorId,
    actorRole: 'operator',
    action: 'subject_erased',
  });
}

/** Disable a source salon atomically with every current projection it owns. */
export async function disableNetworkNoShowPlatformInTx(
  tx: NetworkNoShowHandle,
  args: { operatorId: string; now: Date },
): Promise<void> {
  // Participation is always first for source writers; this blocks a stale
  // register/record transaction before it can enter the subject lock phase.
  await tx.execute(sql`SELECT id FROM network_no_show_platform_control WHERE id = 1 FOR UPDATE`);
  await tx.update(networkNoShowPlatformControlSchema).set({ enabledAt: null, updatedAt: args.now })
    .where(eq(networkNoShowPlatformControlSchema.id, 1));
  await tx.insert(networkNoShowAuditSchema).values({ id: randomUUID(), actorId: args.operatorId, actorRole: 'operator', action: 'platform_disabled' });
}

/** A caller-established local relationship is recorded without raw contacts. */
export async function auditNetworkNoShowReadInTx(
  tx: NetworkNoShowHandle,
  args: { salonId: string; actorId: string; actorRole: string; localTargetId: string },
): Promise<void> {
  await tx.insert(networkNoShowAuditSchema).values({
    id: randomUUID(),
    salonId: args.salonId,
    actorId: args.actorId,
    actorRole: args.actorRole,
    action: `risk_read:${args.localTargetId}`,
  });
}
