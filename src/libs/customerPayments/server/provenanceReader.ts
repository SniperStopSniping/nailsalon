import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { AppointmentPayment } from '@/models/Schema';

import { isCustomerPaymentLedgerTestEnabled } from '../ledgerTestGate';
import { isCustomerPaymentTender, verifyCustomerPaymentTender, verifyLiveWorkspaceTender, verifyOfflineFixtureCaptureTender } from '../provenance';
import { readOfflineFixtureCaptureEvidence } from './fixtureApplicationReader';
import { paymentWorkspaceStateSchema } from './workspaceContract';

type Reader = { select: (fields?: Record<string, unknown>) => any };

/** Legacy rows never touch a new table. Disabled/unknown markers stay unverified. */
export async function enrichCustomerPaymentProvenance<T extends AppointmentPayment>(database: Reader, rows: T[]): Promise<T[]> {
  // A previously enriched object is not evidence for this fresh database read.
  rows = rows.map(row => isCustomerPaymentTender(row) ? Object.fromEntries(Object.entries(row)) as T : row);
  // Existing real money remains readable when new collection is disabled.
  const liveRows = rows.filter(row => row.id.startsWith('lpay_') || row.reference?.startsWith('customer_payment_live:'));
  if (liveRows.length > 0 && ['production', 'preview', 'development', 'test'].includes(process.env.APP_ENV ?? '')) {
    try {
      const firstLive = liveRows[0]!;
      if (liveRows.some(row => row.salonId !== firstLive.salonId || row.appointmentId !== firstLive.appointmentId)) {
        return rows;
      }
      const { customerPaymentWorkspaceSchema, customerPaymentLiveSettlementSchema } = await import('@/models/customerPaymentWorkspaceSchema');
      // One SQL statement is one MVCC snapshot, including on nontransactional readers.
      const evidence = await database.select({ state: customerPaymentWorkspaceSchema.state, settlement: customerPaymentLiveSettlementSchema })
        .from(customerPaymentWorkspaceSchema).innerJoin(customerPaymentLiveSettlementSchema, and(
          eq(customerPaymentLiveSettlementSchema.appointmentId, customerPaymentWorkspaceSchema.appointmentId),
          eq(customerPaymentLiveSettlementSchema.salonId, customerPaymentWorkspaceSchema.salonId),
        )).where(and(eq(customerPaymentWorkspaceSchema.appointmentId, firstLive.appointmentId), eq(customerPaymentWorkspaceSchema.salonId, firstLive.salonId)));
      if (evidence.length) {
        const state = paymentWorkspaceStateSchema.parse(evidence[0].state);
        const settlements = evidence.map((item: { settlement: typeof customerPaymentLiveSettlementSchema.$inferSelect }) => item.settlement);
        rows = rows.map((row) => {
          if (!liveRows.includes(row)) {
            return row;
          }
          try {
            return verifyLiveWorkspaceTender(row, state, settlements, process.env.APP_ENV === 'production');
          } catch {
            return row;
          }
        });
      }
    } catch {
      // A missing or inconsistent source remains visibly unverified.
    }
  }
  const tagged = rows.filter(isCustomerPaymentTender);
  if (tagged.length === 0 || !isCustomerPaymentLedgerTestEnabled()) {
    return rows;
  }
  const first = tagged[0]!;
  if (tagged.some(row => row.salonId !== first.salonId || row.appointmentId !== first.appointmentId)) {
    return rows;
  }
  try {
    const { customerPaymentCaptureSchema, customerPaymentRefundSchema } = await import('@/models/customerPaymentSchema');
    const captures = await database.select().from(customerPaymentCaptureSchema).where(and(
      eq(customerPaymentCaptureSchema.salonId, first.salonId),
      eq(customerPaymentCaptureSchema.appointmentId, first.appointmentId),
    ));
    // Read authority does not depend on the refund writer flag. Disabling
    // future writes can never erase existing refund evidence or its hold.
    const refunds = await database.select().from(customerPaymentRefundSchema).where(and(
      eq(customerPaymentRefundSchema.salonId, first.salonId),
      eq(customerPaymentRefundSchema.appointmentId, first.appointmentId),
    ));
    if (!Array.isArray(refunds) || refunds.some((refund: typeof customerPaymentRefundSchema.$inferSelect) =>
      !captures.some((capture: typeof customerPaymentCaptureSchema.$inferSelect) =>
        capture.id === refund.captureId && capture.salonId === refund.salonId && capture.appointmentId === refund.appointmentId
        && capture.stripeAccountId === refund.stripeAccountId && capture.paymentIntentId === refund.paymentIntentId
        && capture.currency.toUpperCase() === refund.currency.toUpperCase()
        && refund.mode === 'test' && refund.source === 'synthetic_test'))) {
      return rows;
    }
    const fixtureEvidence = await readOfflineFixtureCaptureEvidence(database, captures);
    return rows.map((row) => {
      if (!isCustomerPaymentTender(row) || row.id.startsWith('lpay_')) {
        return row;
      }
      const matches = captures.filter((capture: typeof customerPaymentCaptureSchema.$inferSelect) => capture.tenderId === row.id);
      if (matches.length !== 1) {
        return row;
      }
      const capture = matches[0] as typeof customerPaymentCaptureSchema.$inferSelect;
      if (capture.currency !== 'cad' && capture.currency !== 'CAD') {
        return row;
      }
      if (capture.amountCents !== capture.principalCents + capture.tipCents
        || capture.applicationFeeCents !== capture.quotedApplicationFeeCents) {
        return row;
      }
      try {
        if (capture.source === 'offline_fixture_test') {
          const evidence = fixtureEvidence.find(item => item.application.captureId === capture.id);
          if (!evidence || refunds.some((refund: typeof customerPaymentRefundSchema.$inferSelect) => refund.captureId === capture.id)) {
            return row;
          }
          return verifyOfflineFixtureCaptureTender(row, capture, evidence);
        }
        return verifyCustomerPaymentTender(row, {
          id: capture.id,
          salonId: capture.salonId,
          appointmentId: capture.appointmentId,
          amountCents: capture.amountCents,
          tipCents: capture.tipCents,
          state: capture.state as 'posted' | 'held_review',
          mode: capture.mode as 'test',
          synthetic: (capture.source === 'synthetic_test') as true,
        }, refunds.filter((refund: typeof customerPaymentRefundSchema.$inferSelect) => refund.captureId === capture.id));
      } catch {
        return row;
      }
    });
  } catch {
    // Missing schema/read failures cannot turn provider evidence into manual tender.
    return rows;
  }
}
