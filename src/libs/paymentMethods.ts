/** Canonical recorded-tender methods, shared without importing the database schema. */
export const PAYMENT_METHODS = ['cash', 'debit', 'credit', 'e_transfer', 'online', 'gift_card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
