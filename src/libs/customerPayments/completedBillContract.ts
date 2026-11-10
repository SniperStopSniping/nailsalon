import { z } from 'zod';

import { completeAppointmentSchema } from '@/libs/appointmentCompletionContract';
import type { ResolvedTaxConfig } from '@/libs/checkoutTotals';

export const completedBillChangeSchema = z.object({
  requestId: z.string().uuid(),
  initializationId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  expectedInvoiceHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedTotalDueCents: z.number().int().min(0).max(50_000_000),
  finalItems: completeAppointmentSchema.shape.finalItems.unwrap().min(1),
  discountCents: z.number().int().min(0).max(1_000_000),
  discountReason: z.string().trim().max(200),
  reason: z.string().trim().min(1).max(500),
}).strict();

export type CompletedBillChange = z.infer<typeof completedBillChangeSchema>;
export type CompletedBillView = {
  revision: number;
  invoiceHash: string;
  items: CompletedBillChange['finalItems'];
  discountCents: number;
  discountReason: string;
  tipCents: number;
  taxExempt: boolean;
  taxConfig: ResolvedTaxConfig;
  paidCents: number;
  refundableOnlinePrincipalCents: number;
  depositCreditCents: number;
  canEdit: boolean;
};
