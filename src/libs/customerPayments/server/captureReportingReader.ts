import 'server-only';

import { and, eq, gte, inArray, lt } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import type { AppointmentPayment } from '@/models/Schema';

import { CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED, projectCustomerPaymentCaptureReport } from '../captureReporting';
import { isCustomerPaymentLedgerTestEnabled } from '../ledgerTestGate';

/** Caller supplies all reserved markers in range; no new table read for legacy data. */
export async function readCustomerPaymentCaptureReport(database: Pick<typeof db, 'select'>, input: {
  salonId: string;
  currency: 'CAD' | 'USD';
  start: Date;
  end: Date;
  markers: AppointmentPayment[];
}) {
  if (input.markers.length === 0) {
    return projectCustomerPaymentCaptureReport({ ...input, captures: [] });
  }
  if (!isCustomerPaymentLedgerTestEnabled()) {
    throw new Error(CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED);
  }
  const { customerPaymentCaptureSchema } = await import('@/models/customerPaymentSchema');
  const captures = await database.select().from(customerPaymentCaptureSchema).where(and(
    eq(customerPaymentCaptureSchema.salonId, input.salonId),
    inArray(customerPaymentCaptureSchema.tenderId, input.markers.map(row => row.id)),
    gte(customerPaymentCaptureSchema.capturedAt, input.start),
    lt(customerPaymentCaptureSchema.capturedAt, input.end),
  ));
  return projectCustomerPaymentCaptureReport({ ...input, captures });
}
