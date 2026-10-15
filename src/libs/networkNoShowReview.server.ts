import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import type { NetworkNoShowHandle } from '@/libs/networkNoShow.server';
import { isNetworkNoShowPlatformActiveInTx, recordNetworkNoShowInTx, suppressNetworkNoShowEventInTx } from '@/libs/networkNoShow.server';
import { validateNoShowReport } from '@/libs/noShowReporting';
import { appointmentAuditLogSchema, appointmentSchema, networkNoShowAuditSchema, networkNoShowBookingBindingSchema, networkNoShowEventSchema, networkNoShowSubjectSchema } from '@/models/Schema';

export async function latestNoShowReviewInTx(tx: NetworkNoShowHandle, salonId: string, appointmentId: string) {
  const [review] = await tx.select().from(appointmentAuditLogSchema)
    .where(and(eq(appointmentAuditLogSchema.salonId, salonId), eq(appointmentAuditLogSchema.appointmentId, appointmentId), sql`${appointmentAuditLogSchema.newValue}->>'noShowReview' is not null`))
    .orderBy(desc(appointmentAuditLogSchema.createdAt), desc(appointmentAuditLogSchema.id)).limit(1);
  return review;
}

/** Capability-scoped caller holds the appointment lock. No contact search or event IDs accepted. */
export async function requestNoShowReviewInTx(tx: NetworkNoShowHandle, args: { salonId: string; appointmentId: string; reason: string; now: Date }) {
  const existing = await latestNoShowReviewInTx(tx, args.salonId, args.appointmentId);
  if (existing) {
    return existing.newValue?.noShowReview === 'requested' ? 'requested' as const : 'closed' as const;
  }
  await tx.insert(appointmentAuditLogSchema).values({
    ...buildAppointmentAuditRow({ salonId: args.salonId, appointmentId: args.appointmentId, action: 'admin_override', performedBy: 'customer:private-booking-link', performedByRole: 'client', newValue: { noShowReview: 'requested' }, reason: args.reason }),
    createdAt: args.now,
  });
  const [event] = await tx.select().from(networkNoShowEventSchema)
    .where(and(eq(networkNoShowEventSchema.salonId, args.salonId), eq(networkNoShowEventSchema.appointmentId, args.appointmentId))).limit(1);
  if (event?.state === 'active') {
    await suppressNetworkNoShowEventInTx(tx, { eventId: event.id, operatorId: 'customer:private-booking-link', actorRole: 'client', now: args.now, reason: 'customer_review' });
  }
  return 'requested' as const;
}

/**
 * Only a platform operator can explicitly restore a reviewed contribution.
 * A different suppression, correction, erased identity or expired source wins.
 */
export async function resolveNoShowReviewInTx(tx: NetworkNoShowHandle, args: { salonId: string; appointmentId: string; operatorId: string; decision: 'upheld' | 'removed'; reason: string; expectedUpdatedAt: string; now: Date }): Promise<boolean> {
  const [appointment] = await tx.select().from(appointmentSchema)
    .where(and(eq(appointmentSchema.salonId, args.salonId), eq(appointmentSchema.id, args.appointmentId))).for('update').limit(1);
  const review = await latestNoShowReviewInTx(tx, args.salonId, args.appointmentId);
  if (!appointment || appointment.status !== 'no_show' || appointment.deletedAt || appointment.updatedAt.toISOString() !== args.expectedUpdatedAt || review?.newValue?.noShowReview !== 'requested') {
    return false;
  }
  const platformActive = await isNetworkNoShowPlatformActiveInTx(tx);
  const [event] = await tx.select().from(networkNoShowEventSchema)
    .where(and(eq(networkNoShowEventSchema.salonId, args.salonId), eq(networkNoShowEventSchema.appointmentId, args.appointmentId))).limit(1);
  if (args.decision === 'upheld' && args.now < appointment.startTime) {
    const [sourceAudit] = await tx.select().from(appointmentAuditLogSchema).where(and(eq(appointmentAuditLogSchema.salonId, args.salonId), eq(appointmentAuditLogSchema.appointmentId, args.appointmentId), eq(appointmentAuditLogSchema.action, 'status_changed'), sql`${appointmentAuditLogSchema.newValue}->>'status' = 'no_show'`)).orderBy(appointmentAuditLogSchema.createdAt).limit(1);
    try {
      validateNoShowReport(appointment.startTime, sourceAudit?.newValue?.noShowReport, sourceAudit?.createdAt ?? args.now);
    } catch {
      return false;
    }
  }
  if (args.decision === 'upheld' && event) {
    await tx.execute(sql`select id from network_no_show_subject where id = ${event.subjectId} for update`);
    const [subject] = await tx.select().from(networkNoShowSubjectSchema).where(eq(networkNoShowSubjectSchema.id, event.subjectId)).limit(1);
    const [binding] = await tx.select().from(networkNoShowBookingBindingSchema).where(and(eq(networkNoShowBookingBindingSchema.salonId, args.salonId), eq(networkNoShowBookingBindingSchema.appointmentId, args.appointmentId))).limit(1);
    const [current] = await tx.select().from(networkNoShowEventSchema).where(eq(networkNoShowEventSchema.id, event.id)).limit(1);
    if (!platformActive || subject?.state !== 'active' || binding?.state !== 'eligible' || binding.invalidatedAt || current?.state !== 'suppressed' || current.suppressionReason !== 'customer_review' || current.expiresAt <= args.now) {
      return false;
    }
    await tx.update(networkNoShowEventSchema).set({ state: 'active', revokedAt: null, suppressionReason: null, updatedAt: args.now }).where(eq(networkNoShowEventSchema.id, event.id));
  }
  await tx.insert(appointmentAuditLogSchema).values({
    ...buildAppointmentAuditRow({ salonId: args.salonId, appointmentId: args.appointmentId, action: 'admin_override', performedBy: args.operatorId, performedByRole: 'admin', newValue: { noShowReview: args.decision }, reason: args.reason }),
    // Strict ordering even when a test clock or two operations share an instant.
    createdAt: new Date(Math.max(args.now.getTime(), review.createdAt.getTime() + 1)),
  });
  await tx.insert(networkNoShowAuditSchema).values({ id: crypto.randomUUID(), salonId: args.salonId, eventId: event?.id, actorId: args.operatorId, actorRole: 'operator', action: `customer_review:${args.decision}:${args.appointmentId}` });
  if (args.decision === 'upheld' && !event) {
    await recordNetworkNoShowInTx(tx, { salonId: args.salonId, appointmentId: args.appointmentId, actorId: args.operatorId, actorRole: 'operator', now: args.now });
  }
  return true;
}
