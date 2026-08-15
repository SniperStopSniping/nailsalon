import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { type DatabaseSessionHandle, db } from '@/libs/DB';
import type { DepositCreditRow } from '@/libs/depositCredit';
import { appointmentDepositSchema } from '@/models/Schema';

type DepositCreditDatabase = Pick<DatabaseSessionHandle, 'select'>;

type ReadDepositCreditRowsArgs = {
  salonId: string;
  appointmentId: string;
  database?: DepositCreditDatabase;
  forUpdate?: false;
  appointmentLockHeld?: never;
};

type LockDepositCreditRowsArgs = {
  salonId: string;
  appointmentId: string;
  database: DepositCreditDatabase;
  forUpdate: true;
  /**
   * Compile-time acknowledgement of D6's canonical appointment -> deposit
   * row-lock order. The caller must lock the tenant-scoped appointment first.
   */
  appointmentLockHeld: true;
};

export type LoadAppointmentDepositCreditRowsArgs
  = | ReadDepositCreditRowsArgs
  | LockDepositCreditRowsArgs;

/**
 * Tenant-scoped loader for every deposit row belonging to one appointment.
 *
 * Terminal deposit history may accumulate, so this intentionally has no row
 * cap. Stable ordering keeps resolution, receipts, and audit evidence
 * deterministic. Money writers may request FOR UPDATE only after acknowledging
 * that the appointment row is already locked.
 */
export async function loadAppointmentDepositCreditRows(
  args: LoadAppointmentDepositCreditRowsArgs,
): Promise<DepositCreditRow[]> {
  const database = args.database ?? db;
  const query = database
    .select({
      id: appointmentDepositSchema.id,
      status: appointmentDepositSchema.status,
      amountCents: appointmentDepositSchema.amountCents,
      currency: appointmentDepositSchema.currency,
      stripePaymentIntentId: appointmentDepositSchema.stripePaymentIntentId,
      stripeRefundId: appointmentDepositSchema.stripeRefundId,
      refundedAt: appointmentDepositSchema.refundedAt,
      refundStatus: appointmentDepositSchema.refundStatus,
      refundStatusChangedAt: appointmentDepositSchema.refundStatusChangedAt,
      refundAmountCents: appointmentDepositSchema.refundAmountCents,
      refundRequestedAt: appointmentDepositSchema.refundRequestedAt,
      refundTrigger: appointmentDepositSchema.refundTrigger,
      refundLastErrorCode: appointmentDepositSchema.refundLastErrorCode,
      refundFailureReason: appointmentDepositSchema.refundFailureReason,
      externalRefundObservedCents: appointmentDepositSchema.externalRefundObservedCents,
      refundConflictFlag: appointmentDepositSchema.refundConflictFlag,
      refundTerminalFailureCount: appointmentDepositSchema.refundTerminalFailureCount,
      priorRefundIds: appointmentDepositSchema.priorRefundIds,
      forfeitedAt: appointmentDepositSchema.forfeitedAt,
      forfeitureTaxSnapshot: appointmentDepositSchema.forfeitureTaxSnapshot,
      createdAt: appointmentDepositSchema.createdAt,
    })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.salonId, args.salonId),
      eq(appointmentDepositSchema.appointmentId, args.appointmentId),
    ))
    .orderBy(asc(appointmentDepositSchema.createdAt), asc(appointmentDepositSchema.id));

  return args.forUpdate ? query.for('update') : query;
}
