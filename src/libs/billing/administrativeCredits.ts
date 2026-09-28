/**
 * Operator-issued SMS credits.
 *
 * These are deliberately separate from subscription grants and paid top-ups:
 * an administrative credit is an append-only, non-expiring lot that can be
 * added by a super-admin without contacting a payment or messaging provider.
 */
import 'server-only';

import { eq } from 'drizzle-orm';

import { smsCreditLedgerSchema } from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';
import {
  appendLotGrant,
  computeAvailableBalance,
  lockCreditAccount,
  recomputeCachedBalance,
} from './creditLedger';

export const MAX_ADMINISTRATIVE_SMS_CREDITS = 100_000;

export type AdministrativeCreditInput = {
  salonId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  actorId: string;
  now?: Date;
};

export type AdministrativeCreditResult = {
  lotId: string;
  created: boolean;
  balance: number;
  administrativeBalance: number;
};

export class AdministrativeCreditConflictError extends Error {
  constructor() {
    super('The idempotency key was already used for a different SMS credit grant.');
    this.name = 'AdministrativeCreditConflictError';
  }
}

function isMatchingGrant(
  row: typeof smsCreditLedgerSchema.$inferSelect,
  input: AdministrativeCreditInput,
): boolean {
  return row.salonId === input.salonId
    && row.entryType === 'grant'
    && row.bucket === 'administrative'
    && row.amount === input.amount
    && row.expiresAt === null
    && row.reason === input.reason;
}

/**
 * Add an administrative lot, safely replaying the exact same request and
 * rejecting a reused idempotency key whose target or payload differs.
 *
 * The caller owns the surrounding transaction so its audit event commits with
 * the lot. This function locks the target account before any mutation.
 */
export async function grantAdministrativeSmsCredits(
  tx: BillingDbTransaction,
  input: AdministrativeCreditInput,
): Promise<AdministrativeCreditResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > MAX_ADMINISTRATIVE_SMS_CREDITS) {
    throw new RangeError(`administrative SMS credits must be an integer between 1 and ${MAX_ADMINISTRATIVE_SMS_CREDITS}`);
  }
  if (input.reason.trim().length === 0) {
    throw new RangeError('administrative SMS credit reason is required');
  }

  const now = input.now ?? new Date();
  await lockCreditAccount(tx, input.salonId);

  const [existing] = await tx
    .select()
    .from(smsCreditLedgerSchema)
    .where(eq(smsCreditLedgerSchema.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existing) {
    if (!isMatchingGrant(existing, input)) {
      throw new AdministrativeCreditConflictError();
    }
    const balance = await computeAvailableBalance(tx, input.salonId, now);
    return {
      lotId: existing.id,
      created: false,
      balance: balance.available,
      administrativeBalance: balance.byBucket.administrative ?? 0,
    };
  }

  const grant = await appendLotGrant(tx, {
    salonId: input.salonId,
    bucket: 'administrative',
    amount: input.amount,
    expiresAt: null,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    actor: input.actorId,
  });

  // A same-key request may have won concurrently after our read. Verify its
  // immutable payload before treating the append helper's no-op as a replay.
  const [written] = await tx
    .select()
    .from(smsCreditLedgerSchema)
    .where(eq(smsCreditLedgerSchema.id, grant.lotId))
    .limit(1);
  if (!written || !isMatchingGrant(written, input)) {
    throw new AdministrativeCreditConflictError();
  }

  if (grant.created) {
    await recomputeCachedBalance(tx, input.salonId, now);
  }
  const balance = await computeAvailableBalance(tx, input.salonId, now);
  return {
    lotId: grant.lotId,
    created: grant.created,
    balance: balance.available,
    administrativeBalance: balance.byBucket.administrative ?? 0,
  };
}
