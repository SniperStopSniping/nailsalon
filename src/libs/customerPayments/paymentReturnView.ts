import { z } from 'zod';

export const paymentReturnViewSchema = z.object({
  status: z.enum(['pending', 'received', 'closed', 'review']),
  currency: z.literal('CAD'),
  amountCents: z.number().int().nonnegative().max(50_000_000),
  refundedCents: z.number().int().nonnegative().max(50_000_000),
}).strict();
export type PaymentReturnView = z.infer<typeof paymentReturnViewSchema>;
