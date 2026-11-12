/** Shared error identity keeps reservation protection separate from tender provenance. */
export class CustomerPaymentLifecycleBlockedError extends Error {
  readonly code: string = 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED';

  constructor(message = 'Customer payment history must be reconciled before changing this appointment.') {
    super(message);
    this.name = 'CustomerPaymentLifecycleBlockedError';
  }
}
