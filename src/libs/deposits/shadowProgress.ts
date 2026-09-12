import type { CollectionFact, DisputeFact, RefundFact } from './shadowProjection';

/**
 * A bounded, resumable provider-read cycle. It is shadow evidence only: the
 * persisted cursor never authorizes a financial transition.
 */
export type ShadowProgress = {
  cycleId: string;
  account: string;
  livemode: boolean;
  collection: CollectionFact;
  refunds: RefundFact[];
  disputes: DisputeFact[];
  requestIds: string[];
  refundCursor: string | null;
  disputeCursor: string | null;
  listDiscrepancy: boolean;
  refundsComplete: boolean;
  disputesComplete: boolean;
  generation: number;
  legacyFingerprint: string | null;
};
