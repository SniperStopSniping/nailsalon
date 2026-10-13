import 'server-only';

import { and, eq, gt } from 'drizzle-orm';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import type { NetworkNoShowHandle } from '@/libs/networkNoShow.server';
import { isNetworkNoShowPlatformActiveInTx } from '@/libs/networkNoShow.server';
import type { NoShowReport } from '@/libs/noShowReporting';
import { appointmentAuditLogSchema, type AuditPerformerRole, networkNoShowEventSchema } from '@/models/Schema';

/** Called only by the winning transition, while its source row is locked. */
export async function auditNoShowReportInTx(tx: NetworkNoShowHandle, args: {
  salonId: string;
  appointmentId: string;
  previousStatus: string;
  actorId: string;
  actorRole: AuditPerformerRole;
  report: NoShowReport;
  now: Date;
}) {
  await tx.insert(appointmentAuditLogSchema).values({
    ...buildAppointmentAuditRow({
      appointmentId: args.appointmentId,
      salonId: args.salonId,
      action: 'status_changed',
      performedBy: args.actorId,
      performedByRole: args.actorRole,
      previousValue: { status: args.previousStatus },
      newValue: { status: 'no_show', noShowReport: args.report, markedAt: args.now.toISOString() },
      reason: args.report.reason,
    }),
    createdAt: args.now,
  });
}

/** Minimal acknowledgement for the reporting salon, including idempotent retries. */
export async function noShowSharingInTx(tx: NetworkNoShowHandle, salonId: string, appointmentId: string, now: Date): Promise<'shared' | 'not_shared'> {
  if (!await isNetworkNoShowPlatformActiveInTx(tx)) {
    return 'not_shared';
  }
  const [event] = await tx.select({ id: networkNoShowEventSchema.id }).from(networkNoShowEventSchema)
    .where(and(eq(networkNoShowEventSchema.salonId, salonId), eq(networkNoShowEventSchema.appointmentId, appointmentId), eq(networkNoShowEventSchema.state, 'active'), gt(networkNoShowEventSchema.expiresAt, now))).limit(1);
  return event ? 'shared' : 'not_shared';
}
