import type { ReviewRepeatCooldownDays } from '@/libs/reviewAutomationPolicy';

export type ReviewHistoryEvidence = {
  id: string;
  appointmentId: string | null;
  /** Provider acceptance is recorded as sent. Delivery receipts do not reset it. */
  state: string | null;
  sentAt: Date | null;
  /** An acceptance receipt without a stable intent outcome must fail closed. */
  hasProviderEvidence?: boolean;
};

export type ReviewHistoryDecision = {
  allowed: boolean;
  reason: 'same_appointment' | 'request_pending' | 'outcome_uncertain' | 'repeat_disabled' | 'cooldown' | null;
  blockingId: string | null;
  nextEligibleAt: Date | null;
};

const RELEASED = new Set(['canceled', 'suppressed', 'expired']);
const RESERVED = new Set(['pending', 'claimed', 'blocked_no_credit', 'sending']);

/**
 * Callers supply only salon-scoped, identity-matched history. No observation
 * time is invented for an unknown send. A canceled request row alone is not
 * evidence that its associated intent was never sent.
 */
export function evaluateReviewHistory(input: {
  history: readonly ReviewHistoryEvidence[];
  appointmentId: string;
  cooldownDays: ReviewRepeatCooldownDays;
  now: Date;
}): ReviewHistoryDecision {
  const blocked: (ReviewHistoryDecision & { rank: number })[] = [];
  for (const entry of input.history) {
    if (entry.state !== null && RELEASED.has(entry.state) && !entry.hasProviderEvidence && !entry.sentAt) {
      continue;
    }
    let reason: ReviewHistoryDecision['reason'];
    let rank: number;
    let nextEligibleAt: Date | null = null;
    if (entry.appointmentId === input.appointmentId) {
      reason = 'same_appointment';
      rank = 0;
    } else if (entry.state !== null && RESERVED.has(entry.state)) {
      reason = 'request_pending';
      rank = 1;
    } else if (entry.state !== 'sent' || !entry.sentAt || !Number.isFinite(entry.sentAt.getTime()) || !Number.isFinite(input.now.getTime())) {
      reason = 'outcome_uncertain';
      rank = 2;
    } else if (input.cooldownDays === 'never') {
      reason = 'repeat_disabled';
      rank = 3;
    } else {
      nextEligibleAt = new Date(entry.sentAt.getTime() + input.cooldownDays * 86_400_000);
      if (input.now >= nextEligibleAt) {
        continue;
      }
      reason = 'cooldown';
      rank = 4;
    }
    blocked.push({ allowed: false, reason, blockingId: entry.id, nextEligibleAt, rank });
  }
  // A reservation/unknown outcome takes priority over a calculable cooldown.
  // Among sends, show the latest release time rather than whichever row the
  // database happened to return first.
  blocked.sort((a, b) => a.rank - b.rank
    || (b.nextEligibleAt?.getTime() ?? 0) - (a.nextEligibleAt?.getTime() ?? 0)
    || (a.blockingId ?? '').localeCompare(b.blockingId ?? ''));
  const first = blocked[0];
  return first
    ? { allowed: false, reason: first.reason, blockingId: first.blockingId, nextEligibleAt: first.nextEligibleAt }
    : { allowed: true, reason: null, blockingId: null, nextEligibleAt: null };
}
