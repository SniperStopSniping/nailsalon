import { z } from 'zod';

/** A separate owner activation; saved test drafts never enable collection. */
export const workspacePolicyWriteSchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(2147483645),
  enabled: z.boolean(),
  cancellationPolicy: z.string().trim().max(5000),
}).strict().refine(value => !value.enabled || value.cancellationPolicy.length > 0, {
  message: 'Add the cancellation and refund policy before enabling online payments.',
  path: ['cancellationPolicy'],
});

/** Presentation/management gate only. Provider execution has its own switch. */
export function isPaymentWorkspaceEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (environment.CUSTOMER_PAYMENTS_WORKSPACE_ENABLED !== 'true'
    || !['production', 'preview', 'development', 'test'].includes(environment.APP_ENV ?? '')) {
    return false;
  }
  return environment.VERCEL !== '1'
    || (environment.VERCEL_ENV === 'production' && environment.APP_ENV === 'production')
    || (environment.VERCEL_ENV === 'preview' && environment.APP_ENV === 'preview');
}
