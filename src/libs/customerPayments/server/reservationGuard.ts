import 'server-only';

import { and, eq } from 'drizzle-orm';

import { closedCheckoutOperationSchema } from '@/models/customerPaymentClosedCheckoutSchema';

import { CustomerPaymentLifecycleBlockedError } from './lifecycleErrors';

export class CustomerPaymentReservationBlockedError extends CustomerPaymentLifecycleBlockedError {
  override readonly code = 'CUSTOMER_PAYMENT_RESERVATION_RECONCILIATION_REQUIRED';

  constructor() {
    super('A customer checkout reservation must be reconciled before changing this appointment.');
    this.name = 'CustomerPaymentReservationBlockedError';
  }
}

type Database = { select: (fields?: Record<string, unknown>) => any };

/**
 * Caller holds the tenant-bound appointment lock. Every SDK journal row is an
 * unresolved financial reservation, including review and expired create authority.
 * No runtime flag, Session status, tender marker or booking-slot hold releases it.
 */
export async function hasCustomerPaymentReservationForAppointment(database: Database, salonId: string, appointmentId: string): Promise<boolean> {
  const rows = await database.select({ id: closedCheckoutOperationSchema.id })
    .from(closedCheckoutOperationSchema).where(and(
      eq(closedCheckoutOperationSchema.salonId, salonId),
      eq(closedCheckoutOperationSchema.appointmentId, appointmentId),
      eq(closedCheckoutOperationSchema.executionKind, 'sdk_closed_http_v1'),
    )).limit(1);
  return rows.length > 0;
}

/** Caller holds the appointment lock before any dependent side effect. */
export async function assertCustomerPaymentReservationMutable(database: Database, salonId: string, appointmentId: string): Promise<void> {
  if (await hasCustomerPaymentReservationForAppointment(database, salonId, appointmentId)) {
    throw new CustomerPaymentReservationBlockedError();
  }
}

/** SQL backstop failures can be wrapped by the database driver. */
export function isCustomerPaymentReservationBlocked(error: unknown): boolean {
  const visited = new Set<unknown>();
  let candidate = error;
  while (candidate && typeof candidate === 'object' && !visited.has(candidate)) {
    visited.add(candidate);
    if (candidate instanceof CustomerPaymentReservationBlockedError
      || ('message' in candidate && typeof candidate.message === 'string'
        && candidate.message.includes('CUSTOMER_PAYMENT_RESERVATION_RECONCILIATION_REQUIRED'))) {
      return true;
    }
    candidate = 'cause' in candidate ? candidate.cause : undefined;
  }
  return false;
}

export function customerPaymentReservationBlockedResponse(): Response {
  const error = new CustomerPaymentReservationBlockedError();
  return Response.json({ error: { code: error.code, message: error.message } }, { status: 409 });
}
