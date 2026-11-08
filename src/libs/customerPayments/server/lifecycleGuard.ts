import 'server-only';

import { hasCustomerPaymentTenderForAppointment, listPayments } from '@/libs/appointmentCheckoutServer';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { customerPaymentTipFloor, isCustomerPaymentTender } from '@/libs/customerPayments/provenance';
import type { Appointment } from '@/models/Schema';

export class CustomerPaymentLifecycleBlockedError extends Error {
  readonly code = 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED';

  constructor() {
    super('Customer payment history must be reconciled before changing this appointment.');
    this.name = 'CustomerPaymentLifecycleBlockedError';
  }
}

/** Caller holds the tenant-bound appointment lock, before any dependent writes. */
export async function assertCustomerPaymentLifecycleMutable(
  database: Parameters<typeof hasCustomerPaymentTenderForAppointment>[0],
  salonId: string,
  appointmentId: string,
): Promise<void> {
  // Includes voided/review markers, even with the feature switched off. The
  // canonical legacy ledger is sufficient; no new payment tables are read.
  if (await hasCustomerPaymentTenderForAppointment(database, salonId, appointmentId)) {
    throw new CustomerPaymentLifecycleBlockedError();
  }
}

/**
 * Starting/wrapping service changes no money. Only authoritative posted tender
 * may cross that boundary; held, orphaned, or feature-disabled evidence cannot.
 * Caller holds the appointment lock and independently restricts the transition
 * to waiting -> working or working -> wrap_up.
 */
export async function assertCustomerPaymentServiceProgressionAllowed(
  database: Parameters<typeof hasCustomerPaymentTenderForAppointment>[0],
  appointment: Pick<Appointment, 'id' | 'salonId' | 'amountPaidCents' | 'tipCents' | 'status' | 'paymentStatus'>,
): Promise<void> {
  if (!await hasCustomerPaymentTenderForAppointment(database, appointment.salonId, appointment.id)) {
    return;
  }
  const paymentRows = await listPayments(database, appointment.id);
  const ledger = resolveAppointmentPaymentLedger({
    cachedAmountPaidCents: appointment.amountPaidCents,
    paymentRows,
    expectedSalonId: appointment.salonId,
    appointmentStatus: appointment.status,
    paymentStatus: appointment.paymentStatus,
  });
  if (!ledger.ok || appointment.amountPaidCents === null
    || paymentRows.filter(isCustomerPaymentTender).length !== 1
    || appointment.tipCents < customerPaymentTipFloor(paymentRows)) {
    throw new CustomerPaymentLifecycleBlockedError();
  }
}

export function customerPaymentLifecycleBlockedResponse(error: CustomerPaymentLifecycleBlockedError): Response {
  return Response.json({ error: { code: error.code, message: error.message } }, { status: 409 });
}
