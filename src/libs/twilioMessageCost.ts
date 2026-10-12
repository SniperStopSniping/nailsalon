import 'server-only';

import twilio from 'twilio';

import { Env } from '@/libs/Env';
import { LUSTER_DEFAULT_SENDER_IDENTITY } from '@/libs/smsSender';

export type TwilioCostDelivery = {
  providerMessageId: string;
  senderIdentity: string | null;
  messagingServiceSid: string | null;
};

/** Read only the persisted delivery's account/message; never send or log its body. */
export async function fetchTwilioMessageCost(delivery: TwilioCostDelivery) {
  const sharedIdentity = Env.LUSTER_SMS_SENDER_IDENTITY || LUSTER_DEFAULT_SENDER_IDENTITY;
  const accountSid = delivery.senderIdentity?.startsWith('byo:')
    ? delivery.senderIdentity.slice(4)
    : delivery.senderIdentity === sharedIdentity || delivery.senderIdentity === LUSTER_DEFAULT_SENDER_IDENTITY
      ? Env.TWILIO_ACCOUNT_SID
      : undefined;
  if (!accountSid || !/^AC[0-9a-f]{32}$/i.test(accountSid) || !Env.TWILIO_AUTH_TOKEN) {
    throw new Error('TWILIO_COST_CREDENTIALS_UNAVAILABLE');
  }
  if (!/^SM[0-9a-f]{32}$/i.test(delivery.providerMessageId)) {
    throw new Error('TWILIO_COST_MESSAGE_ID_INVALID');
  }

  const client = twilio(accountSid, Env.TWILIO_AUTH_TOKEN, { timeout: 5_000, autoRetry: false });
  const message = await client.messages(delivery.providerMessageId).fetch().catch(() => {
    // Provider errors can contain message URLs and account details. Persist a
    // bounded code; the durable outbox owns retry/backoff, including 429s.
    throw new Error('TWILIO_COST_LOOKUP_FAILED');
  });
  if (message.sid !== delivery.providerMessageId || message.accountSid !== accountSid
    || (delivery.messagingServiceSid !== null && message.messagingServiceSid !== delivery.messagingServiceSid)) {
    throw new Error('TWILIO_COST_IDENTITY_MISMATCH');
  }

  // Messaging Service actuals arrive asynchronously. Do not terminalize a job
  // until both its segment count and final cost are available and well formed.
  const segments = Number(message.numSegments);
  if (!/^[1-9]\d*$/.test(message.numSegments ?? '') || !Number.isSafeInteger(segments)
    || typeof message.price !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(message.price)
    || !Number.isFinite(Number(message.price))
    || typeof message.priceUnit !== 'string' || !/^[a-z]{3}$/i.test(message.priceUnit)) {
    return null;
  }
  return { priceRaw: message.price, priceCurrency: message.priceUnit.toUpperCase(), numSegments: segments };
}
