/**
 * Production provider send functions for the communication dispatcher —
 * Gate C / C1 (§6.10 of the completion authorization; contract §9.1, §7.5).
 *
 * PRODUCTION-CAPABLE BUT STILL DARK: nothing here weakens the dark posture.
 * The dispatcher's shared-sender resolution rejects every intent long before
 * providerSend is invoked while COMMUNICATIONS_SMS_ENABLED is unset, the
 * platform control row is disabled, or credits are absent. This module only
 * ensures that WHEN the owner lights the stack per the §20 runbook, the seam
 * is complete: Messaging Service addressing, delivery identity in the status
 * callback, and honest unknown-outcome classification.
 *
 * UNKNOWN OUTCOME (§7.5): a timeout or ambiguous transport failure after the
 * request may have reached Twilio throws ProviderOutcomeUnknownError — the
 * dispatcher parks the intent as send_outcome_unknown and NEVER retries it.
 * Only errors that provably occurred before any request left the process
 * (client construction, immediate validation rejections carrying a Twilio
 * error code) surface as ordinary failures eligible for release.
 */

import 'server-only';

import twilio from 'twilio';

import type { EmailSendFn, ProviderSendFn } from '@/libs/communicationDispatcher';
import { Env } from '@/libs/Env';

/**
 * Status-callback URL carrying the delivery identity, so a signed callback
 * can adopt a SID onto an unknown-outcome intent (§7.5 resolution path 1).
 */
export function buildStatusCallbackUrl(deliveryId: string): string | null {
  const origin = Env.NEXT_PUBLIC_APP_URL;
  if (!origin) {
    return null;
  }
  return `${origin}/api/integrations/twilio/status?deliveryId=${encodeURIComponent(deliveryId)}`;
}

/**
 * Shared-sender send. Addresses the MESSAGING SERVICE, never a bare number
 * (contract §9.1 — the shared sender has no phone-number field), so a future
 * toll-free swap changes no send-path code.
 */
export const sendViaSharedMessagingService: ProviderSendFn = async (input) => {
  const accountSid = Env.TWILIO_ACCOUNT_SID;
  const authToken = Env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    // Provably pre-request: no client, no send — ordinary failure (release).
    throw new Error('SENDER_NOT_READY');
  }
  const client = twilio(accountSid, authToken);
  try {
    const message = await client.messages.create({
      to: input.to,
      body: input.body,
      messagingServiceSid: input.messagingServiceSid,
      ...(input.statusCallbackUrl ? { statusCallback: input.statusCallbackUrl } : {}),
    });
    return { sid: message.sid };
  } catch (error) {
    // A Twilio-coded rejection is proof the API RECEIVED and REFUSED the
    // request — a synchronous non-send, safe to release. Anything else
    // (timeout, socket reset, DNS failure mid-flight) is ambiguous: the
    // message may have been accepted, so never classify it as a non-send.
    if (isTwilioApiRejection(error)) {
      throw error instanceof Error ? error : new Error('PROVIDER_REJECTED');
    }
    const { ProviderOutcomeUnknownError } = await import('@/libs/communicationDispatcher');
    throw new ProviderOutcomeUnknownError();
  }
};

/**
 * Twilio API rejections carry a numeric `code` and an HTTP `status` — their
 * presence proves a round trip completed and the API answered with a refusal
 * rather than the transport dying with the outcome in flight.
 */
function isTwilioApiRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; status?: unknown };
  return typeof candidate.code === 'number' && typeof candidate.status === 'number';
}

/**
 * Email lane production implementation: the RAW transactional email
 * primitive, deliberately not the operational-email-once helper — that
 * helper mints its own notification_delivery row, and the dispatcher's
 * email lane already owns the delivery evidence for its intent (one row,
 * idempotent on intent:{id}:email). Idempotency across dispatcher replays
 * comes from the intent state machine: a sent intent is terminal and is
 * never re-claimed. No SMS credits, no consent gates (§3.6).
 */
export const sendIntentEmail: EmailSendFn = async (input) => {
  const { sendTransactionalEmailDetailed } = await import('@/libs/email');
  const escaped = input.body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const result = await sendTransactionalEmailDetailed({
    to: input.recipient,
    subject: input.subject,
    text: input.body,
    html: `<p>${escaped.replace(/\n/g, '<br />')}</p>`,
  });
  if (!result.ok) {
    throw new Error(result.errorCode ?? 'EMAIL_SEND_FAILED');
  }
  return { delivered: true };
};
