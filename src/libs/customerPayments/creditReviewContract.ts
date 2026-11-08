import { z } from 'zod';

const cents = z.number().int().min(0).max(50_000_000);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const amounts = z.object({ serviceCents: cents, taxCents: cents, tipCents: cents, totalCents: cents });
const credit = z.object({ serviceCreditCents: cents, taxCreditCents: cents, tipCreditCents: cents });
const decision = credit.extend({ id: z.string().min(1), previousDecisionId: z.string().nullable(), deltaServiceCreditCents: cents, deltaTaxCreditCents: cents, deltaTipCreditCents: cents, reason: z.string(), createdAt: z.string().datetime() });
const flags = z.object({ testOnly: z.literal(true), nonLegal: z.literal(true), ordinaryActionsBlocked: z.literal(true) });
export const customerPaymentCreditReviewRequestSchema = credit.extend({ requestId: z.string().uuid(), expectedEvidenceRevision: revision, reason: z.string().trim().min(1).max(1000) }).strict();
export const customerPaymentCreditReviewPreviewSchema = flags.extend({
  evidenceRevision: revision,
  original: amounts,
  refunded: z.object({ principalCents: cents, tipCents: cents, totalCents: cents }),
  netTenderCents: cents,
  previousCredit: credit,
  decision: decision.nullable(),
  resolution: z.object({ state: z.literal('resolved'), currency: z.literal('CAD'), creditNoteId: z.string(), evidenceFingerprint: revision, original: amounts, credit: amounts, adjusted: amounts, actualNetTenderCents: cents, collectibleBalanceCents: z.literal(0), ordinaryActionsBlocked: z.literal(true) }).nullable(),
});
export const customerPaymentCreditReviewResultSchema = flags.extend({ decision, replayed: z.boolean(), evidenceMatchesCurrent: z.boolean() });
export type CustomerPaymentCreditReviewPreview = z.infer<typeof customerPaymentCreditReviewPreviewSchema>;
export type CustomerPaymentCreditReviewRequest = z.infer<typeof customerPaymentCreditReviewRequestSchema>;
