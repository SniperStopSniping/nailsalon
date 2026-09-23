import 'server-only';

import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { readCustomerBookingStatus } from '@/libs/customerAssistant/bookingStatus.server';
import { readCustomerBookingOperation } from '@/libs/customerAssistant/operationStore.server';
import { db } from '@/libs/DB';
import { customerBookingOperationSchema, voiceCallSchema } from '@/models/Schema';

import type { VoiceCallState } from './state';
import { getVoiceCall, redactVoiceDraft } from './storage.server';

/** Read-only booking reconciliation: never creates, charges, or sends anything. */
export async function reconcileVoiceCallBooking(callId: string, salonId: string, secret: string): Promise<VoiceCallState | null> {
  const call = await getVoiceCall(callId, salonId);
  const state = call?.draft as VoiceCallState | null;
  if (!call || !state?.consentHash || !state.booking.operation || !state.confirmation || !['committing', 'revoked'].includes(state.confirmation.stage) || (call.leaseExpiresAt && call.leaseExpiresAt > new Date())) {
    return null;
  }
  // Canonical booking locks operation before voice call. Read the operation
  // first here too; never hold a voice row lock while waiting on its operation.
  const operation = await readCustomerBookingOperation({ salonId, capability: state.booking.operation.capability, secret });
  // An unlocked empty snapshot cannot prove a concurrent booking failed.
  // Leave it unresolved until an appointment is positively linked.
  if (operation.sessionId !== call.id || !operation.appointmentId) {
    return null;
  }
  const status = await readCustomerBookingStatus(operation, secret);
  state.bookingStatus = status;
  state.confirmation = { ...state.confirmation, stage: 'committed' };
  const outcome = status.status === 'confirmed' ? 'booked' : ['payment_required', 'payment_processing'].includes(status.status) ? 'deposit_pending' : status.status;
  const [saved] = await db.update(voiceCallSchema).set({
    draft: redactVoiceDraft(state, true),
    appointmentId: status.appointment?.id ?? operation.appointmentId,
    outcome,
    summary: `Recovered from the original Luster booking operation: ${outcome}. No new booking or message was created during recovery.`,
    status: 'completed',
    endedAt: call.endedAt ?? new Date(),
    updatedAt: new Date(),
    leaseToken: null,
    leaseExpiresAt: null,
  }).where(and(eq(voiceCallSchema.id, call.id), eq(voiceCallSchema.salonId, salonId), or(isNull(voiceCallSchema.leaseExpiresAt), lt(voiceCallSchema.leaseExpiresAt, new Date())), sql`${voiceCallSchema.draft}->'confirmation'->>'id' = ${state.confirmation.id}`, sql`${voiceCallSchema.draft}->'confirmation'->>'stage' in ('committing', 'revoked')`)).returning();
  return saved ? state : null;
}

export async function listRecoverableVoiceBookings() {
  // Scan only calls whose canonical operation is already positively linked.
  // A simple oldest-50 call scan can be permanently starved by unresolved
  // operations ahead of a later completed booking; unlinked rows deliberately
  // stay untouched until there is positive evidence to recover.
  return db.select({ id: voiceCallSchema.id, salonId: voiceCallSchema.salonId })
    .from(voiceCallSchema)
    .innerJoin(customerBookingOperationSchema, and(
      eq(customerBookingOperationSchema.salonId, voiceCallSchema.salonId),
      eq(customerBookingOperationSchema.sessionId, voiceCallSchema.id),
      isNotNull(customerBookingOperationSchema.appointmentId),
    ))
    .where(and(
      sql`${voiceCallSchema.draft}->>'consentHash' is not null`,
      sql`${voiceCallSchema.draft}->'confirmation'->>'stage' in ('committing', 'revoked')`,
      or(isNull(voiceCallSchema.leaseExpiresAt), lt(voiceCallSchema.leaseExpiresAt, new Date())),
    ))
    .limit(50);
}

export async function reconcileUnresolvedVoiceBookings(secret: string): Promise<void> {
  const calls = await listRecoverableVoiceBookings();
  // Bound proven recovery work; canonical operation reads still happen before
  // any voice-row update inside reconcileVoiceCallBooking.
  for (const call of calls) {
    await reconcileVoiceCallBooking(call.id, call.salonId, secret).catch(() => null);
  }
}
