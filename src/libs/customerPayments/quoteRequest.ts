import { z } from 'zod';

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';

/** Prices, tax, account, salon, policy and expiry are never accepted from clients. */
export const customerPaymentQuoteRequestSchema = z.object({
  requestId: z.string().uuid(),
  tipCents: z.number().int().min(0).max(MAX_SUPPORTED_MINOR_UNIT_AMOUNT),
}).strict();

export type CustomerPaymentQuoteRequest = z.infer<typeof customerPaymentQuoteRequestSchema>;
