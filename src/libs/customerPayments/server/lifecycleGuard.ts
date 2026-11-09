import 'server-only';

import { hasCustomerPaymentTenderForAppointment, listPayments } from '@/libs/appointmentCheckoutServer';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { customerPaymentTipFloor, isCustomerPaymentTender } from '@/libs/customerPayments/provenance';
import type { Appointment } from '@/models/Schema';

import { CustomerPaymentLifecycleBlockedError } from './lifecycleErrors';
import { assertCustomerPaymentReservationMutable } from './reservationGuard';

export { CustomerPaymentLifecycleBlockedError } from './lifecycleErrors';

/** Caller holds the tenant-bound appointment lock, before any dependent writes. */
export async function assertCustomerPaymentLifecycleMutable(
  database: Parameters<typeof hasCustomerPaymentTenderForAppointment>[0],
  salonId: string,
  appointmentId: string,
): Promise<void> {
  await assertCustomerPaymentReservationMutable(database, salonId, appointmentId);
  // Includes voided/review markers, even with the feature switched off. The
  // tender provenance check remains based on the canonical legacy ledger.
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
  await assertCustomerPaymentReservationMutable(database, appointment.salonId, appointment.id);
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
