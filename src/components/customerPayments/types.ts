export type CustomerPaymentChoice = 'online' | 'in_person';
export type CustomerPaymentPolicy = 'optional_full' | 'required_deposit' | 'full_online_required';

export type CustomerPaymentLine = {
  id: string;
  label: string;
  amountCents: number;
  recipient: string;
};

/** An authoritative server quote; never compute Stripe charges in the browser. */
export type CustomerPaymentQuote = {
  currency: 'CAD';
  choice: CustomerPaymentChoice;
  tipCents: number;
  lines: CustomerPaymentLine[];
  totalCents: number;
  dueNowCents: number;
  remainingCents: number;
};

export type CustomerPaymentSettingsValue = {
  enabled: boolean;
  policy: CustomerPaymentPolicy;
  feePayer: 'salon' | 'customer';
  platformFeeCents: number;
  cancellationPolicy: string;
};

export const DEFAULT_CUSTOMER_PAYMENT_SETTINGS: CustomerPaymentSettingsValue = {
  enabled: false,
  policy: 'optional_full',
  feePayer: 'salon',
  platformFeeCents: 100,
  cancellationPolicy: '',
};

export function formatPaymentMoney(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}
