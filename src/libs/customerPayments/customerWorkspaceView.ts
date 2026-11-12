import { z } from 'zod';

const cents = z.number().int().min(0).max(50_000_000);
export const customerWorkspaceViewSchema = z.object({
  initialized: z.boolean(),
  revision: z.number().int().nonnegative(),
  invoiceHash: z.string().regex(/^[a-f0-9]{64}$/),
  canPay: z.boolean(),
  needsReview: z.boolean(),
  policy: z.object({ revision: z.number().int().nonnegative(), cancellationPolicy: z.string().max(5000) }).strict(),
  totalCents: cents,
  paidCents: cents,
  balanceCents: cents,
  overpaidCents: cents,
  depositCreditCents: cents,
  activePayment: z.object({ id: z.string().uuid(), state: z.string(), canResume: z.boolean() }).strict().nullable(),
}).strict();
export type CustomerWorkspaceView = z.infer<typeof customerWorkspaceViewSchema>;
