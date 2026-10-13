import 'server-only';

import { z } from 'zod';

import type { DatabaseSessionHandle } from '@/libs/DB';
import { sendTransactionalEmailDetailed } from '@/libs/email';
import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';
import { type IntegrationOutboxJob, integrationOutboxSchema } from '@/models/Schema';

const SIGNUP_RECIPIENT = 'support@lustergel.app';
const payloadSchema = z.object({
  salonId: z.string().min(1),
  salonSlug: z.string().min(1),
  salonName: z.string().min(1),
  ownerName: z.string(),
  ownerEmail: z.string().email(),
}).strict();

/** Queue in the business-creation transaction; never wait for email at signup. */
export async function enqueueOwnerSignupNotification(
  tx: Pick<DatabaseSessionHandle, 'insert'>,
  input: z.infer<typeof payloadSchema> & { clerkUserId: string },
) {
  const payload = payloadSchema.parse({
    salonId: input.salonId,
    salonSlug: input.salonSlug,
    salonName: input.salonName,
    ownerName: input.ownerName,
    ownerEmail: input.ownerEmail,
  });
  await tx.insert(integrationOutboxSchema).values({
    id: `io_${crypto.randomUUID()}`,
    salonId: input.salonId,
    provider: 'email',
    operation: 'owner_signup_notification',
    dedupeKey: `owner-signup:${input.clerkUserId}`,
    payload,
  }).onConflictDoNothing({ target: integrationOutboxSchema.dedupeKey });
}

/** Stable provider key plus bounded retries protect against duplicate mail. */
export async function deliverOwnerSignupNotification(
  job: IntegrationOutboxJob,
  options: { now?: Date; signal?: AbortSignal } = {},
): Promise<'sent' | 'expired' | 'cancelled'> {
  // Preview fixtures and local developers must never email the production inbox.
  if (resolveRuntimeEnvironment(process.env) !== 'production') {
    return 'cancelled';
  }
  const now = options.now ?? new Date();
  if (now.getTime() - job.createdAt.getTime() >= 23 * 60 * 60 * 1000) {
    return 'expired';
  }
  const payload = payloadSchema.parse(job.payload);
  if (payload.salonId !== job.salonId) {
    throw new Error('SIGNUP_NOTIFICATION_SCOPE_MISMATCH');
  }
  const workspaceUrl = `https://www.lustergel.app/en/admin?${new URLSearchParams({ salon: payload.salonSlug })}`;
  const text = [
    'A new salon owner signed up for Luster.',
    `Salon: ${payload.salonName}`,
    `Owner: ${payload.ownerName || 'Not provided'}`,
    `Email: ${payload.ownerEmail}`,
    `Signup: ${job.createdAt.toISOString()}`,
    `Workspace: ${workspaceUrl}`,
    'Their salon setup is saved. Publishing and SMS verification are separate steps.',
  ].join('\n');
  const escaped = text.replace(/[&<>"']/g, value => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
  })[value]!);
  const result = await sendTransactionalEmailDetailed({
    to: SIGNUP_RECIPIENT,
    subject: 'New Luster salon signup',
    text,
    html: `<p>${escaped.replace(/\n/g, '<br />')}</p>`,
  }, { signal: options.signal, idempotencyKey: `luster-owner-signup/${job.id}` });
  if (!result.ok) {
    throw new Error(result.errorCode ?? 'SIGNUP_NOTIFICATION_EMAIL_FAILED');
  }
  return 'sent';
}
