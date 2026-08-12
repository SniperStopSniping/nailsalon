import 'server-only';

import { and, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';

import { buildClientPhoneVariants } from '@/libs/activeAppointments';
import type { db } from '@/libs/DB';
import {
  appointmentDepositSchema,
  rewardSchema,
} from '@/models/Schema';

export const ACTIVE_REWARD_ATTRIBUTION_DEPOSIT_STATUSES = [
  'checkout_created',
] as const;

export class RewardAttributionConflictError extends Error {
  constructor(public readonly reason: 'unavailable' | 'already_attributed' | 'identity_mismatch') {
    super(`REWARD_ATTRIBUTION_CONFLICT:${reason}`);
    this.name = 'RewardAttributionConflictError';
  }
}

type RewardAttributionTx = {
  select: typeof db.select;
};

/**
 * Revalidates and locks the exact reward selected before the booking
 * transaction. It never resolves a replacement reward. The deposit INSERT that
 * follows this call stores this exact id in the same transaction.
 */
export async function lockExactRewardForDepositAttribution(
  tx: RewardAttributionTx,
  args: {
    rewardId: string;
    salonId: string;
    clientPhones: readonly string[];
    now?: Date;
  },
): Promise<{ id: string; clientPhone: string }> {
  const phoneVariants = [...new Set(args.clientPhones.flatMap(buildClientPhoneVariants))];
  if (phoneVariants.length === 0) {
    throw new RewardAttributionConflictError('identity_mismatch');
  }

  const now = args.now ?? new Date();
  const [reward] = await tx
    .select({ id: rewardSchema.id, clientPhone: rewardSchema.clientPhone })
    .from(rewardSchema)
    .where(and(
      eq(rewardSchema.id, args.rewardId),
      eq(rewardSchema.salonId, args.salonId),
      inArray(rewardSchema.clientPhone, phoneVariants),
      eq(rewardSchema.status, 'active'),
      isNull(rewardSchema.usedInAppointmentId),
      or(isNull(rewardSchema.expiresAt), gte(rewardSchema.expiresAt, now)),
    ))
    .for('update')
    .limit(1);

  if (!reward) {
    throw new RewardAttributionConflictError('unavailable');
  }

  // The reward-row lock serializes deposit claimers. Once it is acquired, this
  // read sees the prior claimant's committed deposit and turns a stale quote
  // into a typed conflict instead of relying only on the unique-index error.
  const [existing] = await tx
    .select({ id: appointmentDepositSchema.id })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.salonId, args.salonId),
      eq(appointmentDepositSchema.appliedRewardId, reward.id),
      inArray(
        appointmentDepositSchema.status,
        [...ACTIVE_REWARD_ATTRIBUTION_DEPOSIT_STATUSES],
      ),
    ))
    .limit(1);

  if (existing) {
    throw new RewardAttributionConflictError('already_attributed');
  }

  return reward;
}

/**
 * Proves an expired hold still owns its exact reward before TX-C restores it.
 * A terminal hold releases the index reservation, so the reward row itself is
 * the authority for whether an ordinary/manual booking consumed it meanwhile.
 */
export async function lockExactRewardForDepositRestoreInTx(
  tx: RewardAttributionTx,
  args: {
    rewardId: string;
    salonId: string;
    attributedClientId: string;
    appointmentClientId: string | null;
    rewardClientPhone: string;
    appointmentId: string;
    depositId: string;
  },
): Promise<void> {
  if (!args.appointmentClientId || args.attributedClientId !== args.appointmentClientId) {
    throw new RewardAttributionConflictError('identity_mismatch');
  }

  const [reward] = await tx
    .select({
      status: rewardSchema.status,
      usedInAppointmentId: rewardSchema.usedInAppointmentId,
    })
    .from(rewardSchema)
    .where(and(
      eq(rewardSchema.id, args.rewardId),
      eq(rewardSchema.salonId, args.salonId),
      eq(rewardSchema.clientPhone, args.rewardClientPhone),
    ))
    .for('update')
    .limit(1);

  if (
    !reward
    || reward.usedInAppointmentId !== null
    || !['active', 'expired'].includes(reward.status)
  ) {
    throw new RewardAttributionConflictError('unavailable');
  }

  const [competingReservation] = await tx
    .select({ id: appointmentDepositSchema.id })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.salonId, args.salonId),
      eq(appointmentDepositSchema.appliedRewardId, args.rewardId),
      ne(appointmentDepositSchema.id, args.depositId),
      inArray(
        appointmentDepositSchema.status,
        [...ACTIVE_REWARD_ATTRIBUTION_DEPOSIT_STATUSES],
      ),
    ))
    .limit(1);

  if (competingReservation) {
    throw new RewardAttributionConflictError('already_attributed');
  }
}

const REWARD_ATTRIBUTION_CONSTRAINT = 'appointment_deposit_active_reward_uniq';

/** True only for the RWD active-attribution unique index. */
export function isRewardAttributionConstraintViolation(error: unknown): boolean {
  const candidates: unknown[] = [error];
  if (error instanceof Error && error.cause) {
    candidates.push(error.cause);
  }

  return candidates.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }
    const { code, constraint, message } = candidate as {
      code?: string;
      constraint?: string;
      message?: string;
    };
    return code === '23505'
      && (constraint === REWARD_ATTRIBUTION_CONSTRAINT
        || (!constraint && message?.includes(REWARD_ATTRIBUTION_CONSTRAINT) === true));
  });
}
