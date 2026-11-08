import 'server-only';

import type { db } from '@/libs/DB';
import type { AppointmentPayment } from '@/models/Schema';

import { isCustomerPaymentLedgerTestEnabled } from '../ledgerTestGate';
import { isCustomerPaymentTender } from '../provenance';
import type { SyntheticCreditReviewPreview } from './recordSyntheticCreditDecision';

type Resolution = NonNullable<SyntheticCreditReviewPreview['resolution']>;

/**
 * Trusted canonical debt-reader bridge, not collection authority. Legacy inputs
 * never load the new schema. A missing/stale/read-failed decision stays unresolved.
 * The review/refund write switches cannot erase existing immutable adjustments.
 */
export async function readCustomerPaymentCreditForReporting(
  database: Pick<typeof db, 'select' | 'transaction'>,
  input: {
    salonId: string;
    appointmentId: string;
    paymentRows: readonly Pick<AppointmentPayment, 'id' | 'reference'>[];
    asOf: Date;
  },
): Promise<Resolution | null> {
  if (!input.paymentRows.some(isCustomerPaymentTender) || !isCustomerPaymentLedgerTestEnabled()
    || !input.salonId.trim() || !input.appointmentId.trim()
    || !Number.isSafeInteger(input.asOf.getTime())) {
    return null;
  }
  try {
    const { readCurrentCustomerPaymentCreditResolution } = await import('./recordSyntheticCreditDecision');
    const preview = await readCurrentCustomerPaymentCreditResolution(database, {
      salonId: input.salonId,
      appointmentId: input.appointmentId,
    });
    if (!preview.resolution || preview.resolution.state !== 'resolved' || !preview.decision
      || !(preview.decision.createdAt instanceof Date)
      || !Number.isSafeInteger(preview.decision.createdAt.getTime())
      || preview.decision.createdAt > input.asOf
      || preview.resolution.collectibleBalanceCents !== 0
      || preview.resolution.ordinaryActionsBlocked !== true) {
      return null;
    }
    return preview.resolution;
  } catch {
    // Never turn incomplete financial evidence into permission to collect.
    return null;
  }
}
