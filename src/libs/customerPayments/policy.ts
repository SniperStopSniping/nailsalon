/** Pure policy only. Callers must supply server-owned configuration, never request flags. */
export type CustomerPaymentsRuntime = {
  featureEnabled?: boolean;
  deploymentEnvironment?: string;
  stripeMode?: string;
};

export function assertCustomerPaymentsRuntime(runtime: CustomerPaymentsRuntime): void {
  if (runtime.featureEnabled !== true
    || !['development', 'preview', 'test'].includes(runtime.deploymentEnvironment ?? '')
    || runtime.stripeMode !== 'test') {
    throw new Error('CUSTOMER_PAYMENTS_DISABLED');
  }
}

export type CustomerPaymentMode = 'optional_full' | 'required_deposit' | 'full_online_required';
export type CustomerPaymentChoice = 'online' | 'in_person';

export function resolvePaymentChoice(input: {
  mode: CustomerPaymentMode;
  choice: CustomerPaymentChoice;
  requiredDepositCents?: number;
}): 'full' | 'deposit' | 'offline' {
  if (!['optional_full', 'required_deposit', 'full_online_required'].includes(input.mode)
    || !['online', 'in_person'].includes(input.choice)) {
    throw new Error('INVALID_PAYMENT_POLICY');
  }
  if (input.mode === 'required_deposit') {
    if (!Number.isSafeInteger(input.requiredDepositCents) || (input.requiredDepositCents ?? 0) <= 0) {
      throw new Error('INVALID_REQUIRED_DEPOSIT');
    }
    if (input.choice === 'in_person') {
      throw new Error('DEPOSIT_REQUIRED');
    }
    return 'deposit';
  }
  if (input.choice === 'in_person') {
    if (input.mode === 'full_online_required') {
      throw new Error('ONLINE_PAYMENT_REQUIRED');
    }
    return 'offline';
  }
  return 'full';
}
