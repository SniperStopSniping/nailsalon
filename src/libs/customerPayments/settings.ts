import { z } from 'zod';

/** Draft-only policy. Neither this flag nor persistence activates collection. */
export const customerPaymentDraftSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.literal('optional_full'),
  feePayer: z.literal('salon'),
  platformFeeCents: z.number().int().min(0).max(10000),
  cancellationPolicy: z.string().max(5000),
}).strict();

export type CustomerPaymentDraftSettings = z.infer<typeof customerPaymentDraftSettingsSchema>;

export const DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS: Readonly<CustomerPaymentDraftSettings> = Object.freeze({
  enabled: false,
  mode: 'optional_full',
  feePayer: 'salon',
  platformFeeCents: 100,
  cancellationPolicy: '',
});

export const customerPaymentDraftWriteSchema = z.object({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  requestId: z.string().uuid(),
  settings: customerPaymentDraftSettingsSchema,
}).strict();

export type CustomerPaymentDraftWrite = z.infer<typeof customerPaymentDraftWriteSchema>;

export type CustomerPaymentDraftResponse = {
  testOnly: true;
  collectionEnabled: false;
  revision: number;
  settings: CustomerPaymentDraftSettings;
};

export function customerPaymentDraftResponse(revision: number, settings: CustomerPaymentDraftSettings): CustomerPaymentDraftResponse {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('CUSTOMER_PAYMENT_DRAFT_INVALID_REVISION');
  }
  return { testOnly: true, collectionEnabled: false, revision, settings: customerPaymentDraftSettingsSchema.parse(settings) };
}
