import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import {
  type DepositCreditBlockCode,
  type DepositCreditRow,
  resolveDepositCredit,
} from '@/libs/depositCredit';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
import type { DepositsTransactionHandle } from '@/libs/deposits/depositsTransaction';
import {
  buildForfeitureTaxSnapshot,
  type ForfeitureTaxSnapshot,
  hasReviewedForfeitureTaxTreatment,
  resolveTaxConfig,
} from '@/libs/taxConfig';
import {
  appointmentAuditLogSchema,
  appointmentDepositSchema,
  appointmentSchema,
  salonSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

export type DepositForfeitureDisposition =
  | 'no_deposit'
  | 'uncollected'
  | 'fully_refunded'
  | 'already_forfeited'
  | 'forfeited';

export type DepositForfeitureResult = {
  disposition: DepositForfeitureDisposition;
  depositIds: string[];
  forfeitedCents: number;
};

export class DepositForfeitureBlockedError extends Error {
  readonly code: DepositCreditBlockCode;
  readonly depositIds: string[];
  readonly detail: string;

  constructor(input: {
    code: DepositCreditBlockCode;
    depositIds: string[];
    detail: string;
  }) {
    super(input.detail);
    this.name = 'DepositForfeitureBlockedError';
    this.code = input.code;
    this.depositIds = input.depositIds;
    this.detail = input.detail;
  }
}

type BaseForfeitureArgs = {
  tx: DepositsTransactionHandle;
  salonId: string;
  appointmentId: string;
  /** Frozen appointment invoice identity. Mutable salon currency is never used. */
  invoiceCurrency: string | null;
  forfeitedAt: Date;
  /** Acknowledges the repository-wide appointment -> deposit row-lock order. */
  appointmentLockHeld: true;
  /** Present only for an explicit owner decision on a cancelled appointment. */
  ownerAction?: DepositForfeitureOwnerAction;
};

export type DepositForfeitureOwnerAction = {
  performedBy: string;
  performedByName?: string | null;
  reason: string;
};

type LoadAndLockForfeitureArgs = BaseForfeitureArgs & {
  prelockedDeposits?: never;
  depositLocksHeld?: never;
};

type PrelockedForfeitureArgs = BaseForfeitureArgs & {
  /**
   * Used by verified collection, which already owns every appointment deposit
   * lock before changing the selected row to paid. The rows must reflect that
   * successful paid CAS.
   */
  prelockedDeposits: readonly DepositCreditRow[];
  depositLocksHeld: true;
};

export type ForfeitAppointmentDepositArgs
  = | LoadAndLockForfeitureArgs
    | PrelockedForfeitureArgs;

export type ForfeitCancelledAppointmentDepositForOwnerArgs
  = LoadAndLockForfeitureArgs & {
    ownerAction: DepositForfeitureOwnerAction;
  };

export class DepositForfeitureInvalidStateError extends Error {
  readonly code = 'DEPOSIT_FORFEITURE_INVALID_APPOINTMENT_STATE' as const;

  constructor() {
    super('Only a cancelled appointment can use the explicit owner retain action.');
    this.name = 'DepositForfeitureInvalidStateError';
  }
}

/**
 * Safe API boundary for the future owner retain endpoint. Cancellation never
 * implies retention: the caller must supply an explicit owner actor/reason and
 * this helper re-reads the tenant-scoped appointment under the existing lock
 * before it takes any deposit lock.
 */
export async function forfeitCancelledAppointmentDepositForOwnerInTx(
  args: ForfeitCancelledAppointmentDepositForOwnerArgs,
): Promise<DepositForfeitureResult> {
  const [appointment] = await args.tx
    .select({ status: appointmentSchema.status })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.id, args.appointmentId),
      eq(appointmentSchema.salonId, args.salonId),
    ))
    .for('update')
    .limit(1);
  if (appointment?.status !== 'cancelled') {
    throw new DepositForfeitureInvalidStateError();
  }
  if (
    !args.ownerAction.performedBy.trim()
    || !args.ownerAction.reason.trim()
    || args.ownerAction.reason.trim().length > 500
  ) {
    throw new TypeError('Owner forfeiture actor and a reason of at most 500 characters are required.');
  }
  return forfeitAppointmentDepositInTx(args);
}

function blocked(input: {
  code: DepositCreditBlockCode;
  depositIds: string[];
  detail: string;
}): never {
  throw new DepositForfeitureBlockedError(input);
}

function postgresErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') {
      return candidate.code;
    }
    current = candidate.cause;
  }
  return null;
}

/**
 * Freeze a retained no-show deposit and its tax-reporting estimate atomically.
 *
 * Callers must already hold the tenant-scoped appointment row lock. This
 * helper then locks every deposit row in stable order, resolves D6 refund
 * state once, and writes a timestamp/snapshot pair to the one retained paid
 * deposit. Refunded, waived, and uncollected money is never marked forfeited.
 */
export async function forfeitAppointmentDepositInTx(
  args: ForfeitAppointmentDepositArgs,
): Promise<DepositForfeitureResult> {
  const deposits = args.prelockedDeposits ?? await loadAppointmentDepositCreditRows({
    database: args.tx,
    salonId: args.salonId,
    appointmentId: args.appointmentId,
    forUpdate: true,
    appointmentLockHeld: true,
  });

  if (deposits.length === 0) {
    return { disposition: 'no_deposit', depositIds: [], forfeitedCents: 0 };
  }

  const resolution = resolveDepositCredit({
    deposits,
    invoiceCurrency: args.invoiceCurrency ?? '',
  });
  if (!resolution.ok) {
    return blocked({
      code: resolution.code,
      depositIds: resolution.depositIds,
      detail: resolution.detail,
    });
  }

  if (resolution.state === 'fully_refunded') {
    return {
      disposition: 'fully_refunded',
      depositIds: resolution.refundedDepositIds,
      forfeitedCents: resolution.forfeitedDepositCents,
    };
  }
  if (resolution.state === 'forfeited') {
    return {
      disposition: 'already_forfeited',
      depositIds: resolution.forfeitedDepositIds,
      forfeitedCents: resolution.forfeitedDepositCents,
    };
  }
  if (resolution.state === 'none') {
    return {
      disposition: 'uncollected',
      depositIds: [],
      forfeitedCents: 0,
    };
  }

  const depositId = resolution.creditedDepositIds[0];
  const retained = depositId
    ? deposits.find(deposit => deposit.id === depositId)
    : null;
  if (!retained || resolution.creditedDepositIds.length !== 1) {
    return blocked({
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      depositIds: resolution.creditedDepositIds,
      detail: 'The retained deposit identity is not singular and deterministic.',
    });
  }

  // Preserve the repository-wide appointment -> deposit lock order, then
  // acquire the mutable financial configuration without waiting in the
  // inverse order used by settings/booking. A savepoint is required because a
  // PostgreSQL NOWAIT conflict otherwise leaves the whole transaction aborted.
  await args.tx.execute(sql.raw('SAVEPOINT forfeiture_salon_config_lock'));
  try {
    await args.tx.execute(sql`
      SELECT ${salonSchema.id}
      FROM ${salonSchema}
      WHERE ${salonSchema.id} = ${args.salonId}
      FOR SHARE NOWAIT
    `);
    await args.tx.execute(sql.raw('RELEASE SAVEPOINT forfeiture_salon_config_lock'));
  } catch (error) {
    if (postgresErrorCode(error) === '55P03') {
      await args.tx.execute(sql.raw('ROLLBACK TO SAVEPOINT forfeiture_salon_config_lock'));
      await args.tx.execute(sql.raw('RELEASE SAVEPOINT forfeiture_salon_config_lock'));
      return blocked({
        code: 'DEPOSIT_RECONCILIATION_REQUIRED',
        depositIds: [retained.id],
        detail: 'Salon financial settings are being updated. Retry the forfeiture after reviewing the effective tax configuration.',
      });
    }
    throw error;
  }
  const [salon] = await args.tx
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, args.salonId))
    .limit(1);
  if (!salon) {
    return blocked({
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      depositIds: [retained.id],
      detail: 'The deposit tenant is missing, so forfeiture tax identity cannot be frozen.',
    });
  }

  const taxConfig = resolveTaxConfig(
    (salon.settings as SalonSettings | null | undefined) ?? null,
    args.forfeitedAt,
  );
  let snapshot: ForfeitureTaxSnapshot;
  try {
    snapshot = buildForfeitureTaxSnapshot({
      taxConfig,
      grossForfeitedCents: retained.amountCents,
      capturedAt: args.forfeitedAt,
      currency: args.invoiceCurrency ?? '',
      estimateTaxIncluded: hasReviewedForfeitureTaxTreatment(taxConfig),
    });
  } catch (error) {
    return blocked({
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      depositIds: [retained.id],
      detail: error instanceof Error
        ? `Forfeiture snapshot could not be built: ${error.message}`
        : 'Forfeiture snapshot could not be built.',
    });
  }

  const updated = await args.tx
    .update(appointmentDepositSchema)
    .set({
      forfeitedAt: args.forfeitedAt,
      forfeitureTaxSnapshot: snapshot,
      updatedAt: args.forfeitedAt,
    })
    .where(and(
      eq(appointmentDepositSchema.id, retained.id),
      eq(appointmentDepositSchema.salonId, args.salonId),
      eq(appointmentDepositSchema.appointmentId, args.appointmentId),
      eq(appointmentDepositSchema.status, 'paid'),
      isNull(appointmentDepositSchema.forfeitedAt),
      isNull(appointmentDepositSchema.forfeitureTaxSnapshot),
    ))
    .returning();

  if (updated.length !== 1) {
    return blocked({
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      depositIds: [retained.id],
      detail: 'The paid deposit changed while its forfeiture evidence was being frozen.',
    });
  }

  await args.tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({
    appointmentId: args.appointmentId,
    salonId: args.salonId,
    action: 'deposit_forfeited',
    performedBy: args.ownerAction?.performedBy ?? 'system',
    performedByRole: args.ownerAction ? 'admin' : 'system',
    performedByName: args.ownerAction?.performedByName ?? undefined,
    newValue: {
      depositId: retained.id,
      appointmentId: args.appointmentId,
      trigger: args.ownerAction ? 'owner_cancelled' : 'no_show',
      origin: 'd6_1_forfeiture',
    },
    reason: args.ownerAction?.reason.trim() ?? 'Collected deposit retained after no-show.',
  }));

  return {
    disposition: 'forfeited',
    depositIds: [retained.id],
    forfeitedCents: retained.amountCents,
  };
}
