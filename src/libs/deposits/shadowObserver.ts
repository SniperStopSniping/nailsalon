import 'server-only';

import { stripe } from '@/libs/stripe';

import { isInsideDepositsTransaction } from './depositsTransaction';
import type { ShadowProgress } from './shadowProgress';
import { type CollectionFact, type DisputeFact, minorUnits, type Observation, providerId, record, type RefundFact, shortText } from './shadowProjection';
import { claimShadowWork, finalizeShadowObservation, knownShadowRefundIds, replayShadowReceipts, type ShadowClaim } from './shadowStore';

const PAGE_BUDGET = 4;
const FINALIZATION_RESERVE_MS = 1_500;

/** Read-only transport seam. Every request carries original account, deadline and cancellation. */
export type ShadowReadContext = { account: string; livemode: boolean; deadline: number; signal: AbortSignal };
export type ShadowProvider = {
  collection: (paymentIntentId: string, ctx: ShadowReadContext) => Promise<{ fact: CollectionFact; requestId: string | null }>;
  refunds: (chargeId: string, cursor: string | null, ctx: ShadowReadContext) => Promise<{ data: RefundFact[]; hasMore: boolean; requestId: string | null }>;
  refund: (id: string, ctx: ShadowReadContext) => Promise<RefundFact>;
  disputes: (chargeId: string, cursor: string | null, ctx: ShadowReadContext) => Promise<{ data: DisputeFact[]; hasMore: boolean; requestId: string | null }>;
};

function checkBudget(ctx: ShadowReadContext): void {
  if (isInsideDepositsTransaction()) {
    throw new Error('shadow_provider_inside_transaction');
  }
  if (ctx.signal.aborted || ctx.deadline - Date.now() < 1000) {
    throw new Error('observation_deadline');
  }
}
function options(ctx: ShadowReadContext) {
  checkBudget(ctx);
  return { stripeAccount: ctx.account, maxNetworkRetries: 0, timeout: Math.max(1, ctx.deadline - Date.now() - 500) };
}
function scope(value: unknown, ctx: ShadowReadContext): Record<string, unknown> {
  const obj = record(value);
  if (obj.livemode !== ctx.livemode) {
    throw new Error('provider_scope_conflict');
  }
  return obj;
}
function requiredId(value: unknown): string {
  const id = providerId(value);
  if (!id) {
    throw new Error('provider_identity_deficient');
  }
  return id;
}
function requiredAmount(value: unknown): number {
  const amount = minorUnits(value);
  if (amount === null) {
    throw new Error('provider_amount_deficient');
  }
  return amount;
}
function requiredCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z]{3}$/.test(value)) {
    throw new Error('provider_currency_deficient');
  }
  return value;
}
function refundFact(value: unknown, ctx: ShadowReadContext): RefundFact {
  // The pinned Refund DTO has no livemode field. Its scope comes from the
  // original-account request and the cycle's verified PI/Charge mode.
  const r = record(value);
  if ('livemode' in r && r.livemode !== ctx.livemode) {
    throw new Error('provider_scope_conflict');
  }
  return { id: requiredId(r.id), chargeId: requiredId(r.charge), paymentIntentId: requiredId(r.payment_intent), amount: requiredAmount(r.amount), currency: requiredCurrency(r.currency), status: shortText(r.status) ?? 'unknown', failureReason: shortText(r.failure_reason), pendingReason: shortText(r.pending_reason), nextActionType: shortText(record(r.next_action).type), failureBalanceTransaction: providerId(r.failure_balance_transaction), created: minorUnits(r.created) };
}

/** No create/update/cancel API is present in this adapter. Remote contract remains an R5 prerequisite. */
export const stripeShadowProvider: ShadowProvider = {
  async collection(paymentIntentId, ctx) {
    const receivedPi = await stripe.paymentIntents.retrieve(paymentIntentId, {}, options(ctx));
    checkBudget(ctx);
    const pi = scope(receivedPi, ctx);
    if (pi.id !== paymentIntentId) {
      throw new Error('provider_identity_conflict');
    }
    const amountCaptured = requiredAmount(pi.amount_received);
    const intendedAmount = requiredAmount(pi.amount);
    const chargeId = requiredId(pi.latest_charge);
    const receivedCharge = await stripe.charges.retrieve(chargeId, {}, options(ctx));
    checkBudget(ctx);
    const charge = scope(receivedCharge, ctx);
    if (charge.id !== chargeId) {
      throw new Error('provider_identity_conflict');
    }
    return {
      fact: {
        id: requiredId(charge.id),
        paymentIntentId: requiredId(charge.payment_intent),
        amount: requiredAmount(charge.amount),
        currency: requiredCurrency(charge.currency),
        paid: charge.paid === true,
        captured: charge.captured === true && requiredAmount(charge.amount_captured) === amountCaptured
          && pi.status === 'succeeded' && amountCaptured === intendedAmount,
        amountCaptured,
        disputed: typeof charge.disputed === 'boolean' ? charge.disputed : null,
        amountRefunded: requiredAmount(charge.amount_refunded),
      },
      requestId: receivedCharge.lastResponse?.requestId ?? null,
    };
  },
  async refunds(chargeId, cursor, ctx) {
    const page = await stripe.refunds.list({ charge: chargeId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, options(ctx));
    checkBudget(ctx);
    return { data: page.data.map(r => refundFact(r, ctx)), hasMore: page.has_more, requestId: page.lastResponse?.requestId ?? null };
  },
  async refund(id, ctx) {
    const receivedRefund = await stripe.refunds.retrieve(id, {}, options(ctx));
    checkBudget(ctx);
    const result = refundFact(receivedRefund, ctx);
    if (result.id !== id) {
      throw new Error('provider_identity_conflict');
    }
    return result;
  },
  async disputes(_chargeId, cursor, ctx) {
    // List on the original connected account and filter exact charge locally: the pinned API has no charge filter.
    const page = await stripe.disputes.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, options(ctx));
    checkBudget(ctx);
    const data = page.data.map((value) => {
      const d = scope(value, ctx);
      return { id: requiredId(d.id), chargeId: requiredId(d.charge), paymentIntentId: providerId(d.payment_intent), amount: requiredAmount(d.amount), currency: requiredCurrency(d.currency), status: shortText(d.status) ?? 'unknown', provisionalDebit: null, reimbursedPrincipal: null, restoredPrincipal: null, fees: null };
    });
    // Preserve the page's last identity for pagination, even if this page has no matching dispute.
    return { data, hasMore: page.has_more, requestId: page.lastResponse?.requestId ?? null };
  },
};

type ResumableObservation = Observation;

function sameCollection(left: CollectionFact, right: CollectionFact): boolean {
  return left.id === right.id && left.paymentIntentId === right.paymentIntentId
    && left.amount === right.amount && left.currency === right.currency && left.paid === right.paid
    && left.captured === right.captured && left.amountCaptured === right.amountCaptured
    && left.disputed === right.disputed && left.amountRefunded === right.amountRefunded;
}

function newProgress(claim: ShadowClaim, collection: CollectionFact, requestId: string | null): ShadowProgress {
  return {
    cycleId: crypto.randomUUID(),
    account: claim.account,
    livemode: claim.livemode,
    collection,
    refunds: [],
    disputes: [],
    requestIds: requestId ? [requestId] : [],
    refundCursor: null,
    disputeCursor: null,
    listDiscrepancy: false,
    refundsComplete: false,
    disputesComplete: false,
    generation: claim.generation,
    legacyFingerprint: claim.legacy_fingerprint,
  };
}

function matchingProgress(claim: ShadowClaim): ShadowProgress | null {
  // `cursor` is added to the store claim as the migration-backed JSON shape.
  // The narrow structural read keeps this pure reader independently buildable
  // while the store owns SQL row decoding.
  const progress = (claim as ShadowClaim & { cursor?: ShadowProgress | null }).cursor ?? null;
  if (!progress || !claim.payment_intent_id || progress.generation !== claim.generation
    || progress.legacyFingerprint !== claim.legacy_fingerprint || progress.account !== claim.account
    || progress.livemode !== claim.livemode || progress.collection.paymentIntentId !== claim.payment_intent_id
    || (claim.charge_id !== null && progress.collection.id !== claim.charge_id)) {
    return null;
  }
  return progress;
}

function addRequestId(progress: ShadowProgress, requestId: string | null): void {
  if (requestId && !progress.requestIds.includes(requestId)) {
    progress.requestIds.push(requestId);
  }
}

function nextCursor(
  cursor: string | null,
  data: Array<{ id: string }>,
  hasMore: boolean,
): string | null {
  if (!hasMore) {
    return null;
  }
  const next = data.at(-1)?.id;
  if (!next || next === cursor) {
    throw new Error('pagination_cursor_deficient');
  }
  return next;
}

function resultFrom(progress: ShadowProgress, pagesComplete: boolean, disputePagesComplete: boolean): ResumableObservation {
  return {
    cycleId: progress.cycleId,
    account: progress.account,
    livemode: progress.livemode,
    collection: progress.collection,
    refunds: progress.refunds,
    disputes: progress.disputes,
    pagesComplete,
    disputePagesComplete,
    requestIds: progress.requestIds,
    progress,
  };
}

function completeResult(progress: ShadowProgress): ResumableObservation {
  return {
    ...resultFrom(progress, true, true),
    // A complete cycle must be rediscovered at its next due time. Retaining a
    // finished cursor would reuse an old refund/dispute set after a Dashboard
    // change that was not accompanied by a receipt.
    progress: null,
  };
}

export async function observeShadowClaim(claim: ShadowClaim, provider: ShadowProvider = stripeShadowProvider) {
  const controller = new AbortController();
  const ctx = {
    account: claim.account,
    livemode: claim.livemode,
    deadline: claim.deadline - FINALIZATION_RESERVE_MS,
    signal: controller.signal,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let staged: ResumableObservation | null = null;
  try {
    const read = async (): Promise<ResumableObservation> => {
      if (!claim.payment_intent_id) {
        throw new Error('missing_payment_identity');
      }
      checkBudget(ctx);
      const before = await provider.collection(claim.payment_intent_id, ctx);
      checkBudget(ctx);
      let progress = matchingProgress(claim);
      if (!progress || !sameCollection(progress.collection, before.fact)) {
        progress = newProgress(claim, before.fact, before.requestId);
      } else {
        // A resumed cycle rechecks its original collection before it adds more pages.
        addRequestId(progress, before.requestId);
      }
      staged = resultFrom(progress, false, false);
      let remainingPages = PAGE_BUDGET;
      while (remainingPages > 0 && !progress.refundsComplete) {
        checkBudget(ctx);
        const page = await provider.refunds(progress.collection.id, progress.refundCursor, ctx);
        checkBudget(ctx);
        progress.refunds.push(...page.data);
        addRequestId(progress, page.requestId);
        remainingPages -= 1;
        if (!page.hasMore) {
          progress.refundsComplete = true;
          progress.refundCursor = null;
        } else {
          progress.refundCursor = nextCursor(progress.refundCursor, page.data, page.hasMore);
        }
        staged = resultFrom(progress, false, false);
      }
      let knownRefundsResolved = true;
      if (progress.refundsComplete) {
        const known = await knownShadowRefundIds(claim);
        checkBudget(ctx);
        for (const id of known) {
          if (!progress.refunds.some(refund => refund.id === id)) {
            knownRefundsResolved = false;
            progress.listDiscrepancy = true;
            if (remainingPages === 0) {
              break;
            }
            checkBudget(ctx);
            const refund = await provider.refund(id, ctx);
            checkBudget(ctx);
            if (refund.id !== id) {
              throw new Error('provider_identity_conflict');
            }
            progress.refunds.push(refund);
            remainingPages -= 1;
            staged = resultFrom(progress, false, false);
          }
        }
      }
      while (remainingPages > 0 && !progress.disputesComplete) {
        checkBudget(ctx);
        // The account-wide adapter preserves its raw page cursor. Only exact-charge
        // rows join evidence, so unrelated disputes cannot enter this progress record.
        const page = await provider.disputes(progress.collection.id, progress.disputeCursor, ctx);
        checkBudget(ctx);
        progress.disputes.push(...page.data.filter(dispute => dispute.chargeId === progress.collection.id));
        addRequestId(progress, page.requestId);
        remainingPages -= 1;
        if (!page.hasMore) {
          progress.disputesComplete = true;
          progress.disputeCursor = null;
        } else {
          progress.disputeCursor = nextCursor(progress.disputeCursor, page.data, page.hasMore);
        }
        staged = resultFrom(progress, false, false);
      }
      if (progress.refundsComplete && progress.disputesComplete && progress.listDiscrepancy) {
        // Exact retrieval preserves money evidence but cannot erase a complete-list discrepancy.
        // Restart discovery on the next claim; do not certify this mixed cycle.
        return { ...resultFrom(progress, false, true), progress: null };
      }
      if (!progress.refundsComplete || !progress.disputesComplete || !knownRefundsResolved) {
        return resultFrom(progress, false, false);
      }
      checkBudget(ctx);
      const after = await provider.collection(claim.payment_intent_id, ctx);
      checkBudget(ctx);
      if (!sameCollection(progress.collection, after.fact)) {
        // Provider pagination is not an atomic snapshot. Preserve no mixed cycle;
        // the next claim begins with this later collection snapshot.
        const restarted = newProgress(claim, after.fact, after.requestId);
        return resultFrom(restarted, false, false);
      }
      addRequestId(progress, after.requestId);
      return completeResult(progress);
    };
    const finalize = async (observation: ResumableObservation | null, failure: string | null = null) => {
      // The provider read deadline deliberately leaves this interval for the short
      // local finalization transaction. Never start it after the claim has expired.
      if (Date.now() >= claim.deadline) {
        return 'stale' as const;
      }
      return finalizeShadowObservation(claim, observation, failure);
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('observation_deadline'));
      }, Math.max(1, ctx.deadline - Date.now()));
    });
    const observation = await Promise.race([read(), timeout]);
    checkBudget(ctx);
    return await finalize(observation);
  } catch (error) {
    // Only our bounded vocabulary enters diagnostics; provider messages may contain sensitive data.
    const message = error instanceof Error && /^(?:provider_|observation_|missing_payment_|pagination_)[a-z_]+$/.test(error.message)
      ? error.message
      : 'provider_read_unavailable';
    if (Date.now() >= claim.deadline) {
      return 'stale' as const;
    }
    return finalizeShadowObservation(claim, staged, message);
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

/** Explicitly invoked only; no hosted cron calls R1. Legacy money remains the sole financial authority. */
export async function runShadowObservationBatch(input: { limit: number; deadline: number; provider?: ShadowProvider }) {
  // Reserve a useful provider opportunity and finalization time. Replay cannot
  // spend an entire batch waiting on a different account's receipt lock.
  const observationMinimumMs = FINALIZATION_RESERVE_MS + 1_100;
  const replayDeadline = Math.min(Date.now() + 1000, input.deadline - observationMinimumMs);
  await replayShadowReceipts(input.limit, replayDeadline);
  const limit = Math.min(100, Math.max(1, input.limit));
  let reserved = 0;
  const results: Array<Awaited<ReturnType<typeof observeShadowClaim>>> = [];
  // Bounded lanes claim just in time, one item per actual observation attempt.
  // A slow account occupies one lane, not a whole preclaimed batch. Unstarted
  // tenants keep their service priority for the next invocation.
  const worker = async () => {
    while (reserved < limit && input.deadline - Date.now() >= observationMinimumMs) {
      reserved += 1;
      const [claim] = await claimShadowWork(1, input.deadline, observationMinimumMs);
      if (!claim) {
        return;
      }
      results.push(await observeShadowClaim(claim, input.provider));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, limit) }, worker));
  return { claimed: results.length, results };
}
