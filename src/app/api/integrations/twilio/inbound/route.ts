/**
 * Signed Twilio inbound handling. Shared STOP/START updates global sender
 * suppression; connected-salon traffic updates only that salon's consent.
 * Receiving identity is exact and every inbound is provider-SID idempotent.
 * Ordinary replies retain metadata only; this product does not offer an inbox.
 */
import { and, eq, gte, inArray, or } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import {
  appendGlobalConsentEvent,
  normalizeConsentRecipient,
} from '@/libs/smsConsentShared';
import { LUSTER_DEFAULT_SENDER_IDENTITY } from '@/libs/smsSender';
import { validateTwilioWebhook } from '@/libs/twilioWebhook';
import {
  communicationConsentSchema,
  communicationIntentSchema,
  notificationDeliverySchema,
  salonTwilioConnectionSchema,
  smsInboundEventSchema,
} from '@/models/Schema';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const TWIML_HEADERS = { 'Content-Type': 'text/xml' };

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT']);
const START_KEYWORDS = new Set(['START', 'UNSTOP']);
const HELP_KEYWORDS = new Set(['HELP']);

const ATTRIBUTION_WINDOW_MS = 72 * 60 * 60 * 1000;

type KeywordClassification = 'stop' | 'start' | 'help' | 'cancel' | 'other';

function classifyKeyword(body: string, optOutType: string): KeywordClassification {
  if (optOutType === 'STOP' || STOP_KEYWORDS.has(body)) {
    // CANCEL is surfaced distinctly for evidence/audit, but it is an
    // OPT-OUT: the appointment row is never touched by this route.
    return body === 'CANCEL' ? 'cancel' : 'stop';
  }
  if (optOutType === 'START' || START_KEYWORDS.has(body)) {
    return 'start';
  }
  if (optOutType === 'HELP' || HELP_KEYWORDS.has(body)) {
    return 'help';
  }
  return 'other';
}

/** 0 salons → unattributed; exactly 1 → attributed; n → ambiguous. Never guess. */
async function attributeSharedInbound(recipient: string, now: Date): Promise<{
  state: 'attributed' | 'unattributed' | 'ambiguous';
  salonId: string | null;
}> {
  const horizon = new Date(now.getTime() - ATTRIBUTION_WINDOW_MS);
  const rows = await db
    .selectDistinct({ salonId: communicationIntentSchema.salonId })
    .from(communicationIntentSchema)
    .innerJoin(notificationDeliverySchema, eq(notificationDeliverySchema.intentId, communicationIntentSchema.id))
    .where(and(
      eq(notificationDeliverySchema.salonId, communicationIntentSchema.salonId),
      eq(notificationDeliverySchema.senderIdentity, Env.LUSTER_SMS_SENDER_IDENTITY || LUSTER_DEFAULT_SENDER_IDENTITY),
      eq(communicationIntentSchema.recipient, recipient),
      eq(communicationIntentSchema.channel, 'sms'),
      inArray(communicationIntentSchema.status, ['sent', 'send_outcome_unknown']),
      gte(communicationIntentSchema.updatedAt, horizon),
    ))
    .limit(3);
  if (rows.length === 1) {
    return { state: 'attributed', salonId: rows[0]!.salonId };
  }
  return { state: rows.length === 0 ? 'unattributed' : 'ambiguous', salonId: null };
}

async function handleSharedInbound(params: Record<string, string>): Promise<Response> {
  const now = new Date();
  const senderIdentity = Env.LUSTER_SMS_SENDER_IDENTITY || LUSTER_DEFAULT_SENDER_IDENTITY;
  const recipient = normalizeConsentRecipient(params.From || '');
  const providerSid = params.MessageSid || params.SmsSid || '';
  const rawBody = (params.Body || '').trim();
  const keyword = classifyKeyword(rawBody.toUpperCase(), (params.OptOutType || '').trim().toUpperCase());
  if (recipient.length === 0 || providerSid.length === 0) {
    return new Response(EMPTY_TWIML, { headers: TWIML_HEADERS });
  }

  if (keyword === 'stop' || keyword === 'cancel') {
    await appendGlobalConsentEvent({
      senderIdentity,
      recipient,
      state: 'suppressed',
      keywordClassification: keyword,
      optOutType: (params.OptOutType || '').trim().toUpperCase() || null,
      source: 'twilio_inbound',
      providerSid,
      occurredAt: now,
    });
  } else if (keyword === 'start') {
    // GLOBAL restore only: per-salon consent is an independent gate that
    // this route never grants (§10.1).
    await appendGlobalConsentEvent({
      senderIdentity,
      recipient,
      state: 'restored',
      keywordClassification: keyword,
      optOutType: (params.OptOutType || '').trim().toUpperCase() || null,
      source: 'twilio_inbound',
      providerSid,
      occurredAt: now,
    });
  }

  const attribution = await attributeSharedInbound(recipient, now);
  // Evidence row for EVERY shared inbound — never the body itself.
  await db
    .insert(smsInboundEventSchema)
    .values({
      id: `sie_${crypto.randomUUID()}`,
      attributedSalonId: attribution.salonId,
      senderIdentity,
      fromRecipient: recipient,
      toNumber: params.To || '',
      keywordClassification: keyword,
      attributionState: attribution.state,
      bodyPresent: rawBody.length > 0,
      segmentCount: Number.parseInt(params.NumSegments || '', 10) || null,
      providerSid,
      receivedAt: now,
    })
    .onConflictDoNothing();

  return new Response(EMPTY_TWIML, { headers: TWIML_HEADERS });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const params = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  if (!await validateTwilioWebhook(request, params)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Shared/BYO discriminator — BEFORE any connection lookup. BYO Messaging
  // Services have this same URL baked in, so shared traffic is identified
  // positively by the platform's own Messaging Service SID.
  const isSharedTraffic
    = Boolean(Env.TWILIO_MESSAGING_SERVICE_SID)
    && params.MessagingServiceSid === Env.TWILIO_MESSAGING_SERVICE_SID;
  if (isSharedTraffic && (!Env.TWILIO_ACCOUNT_SID || params.AccountSid !== Env.TWILIO_ACCOUNT_SID)) {
    return new Response('Forbidden', { status: 403 });
  }
  if (isSharedTraffic) {
    return handleSharedInbound(params);
  }

  // Resolve the exact connected account AND its receiving identity. An
  // account/number disagreement must never select whichever salon sorts first.
  const from = normalizeConsentRecipient(params.From || '');
  const to = params.To || '';
  const accountSid = params.AccountSid || '';
  const providerSid = params.MessageSid || params.SmsSid || '';
  if (from.length !== 10 || !to || !accountSid || !providerSid) {
    return new Response('Invalid inbound message', { status: 400 });
  }
  const connections = await db.select().from(salonTwilioConnectionSchema).where(and(
    eq(salonTwilioConnectionSchema.connectAccountSid, accountSid),
    eq(salonTwilioConnectionSchema.status, 'active'),
    or(
      eq(salonTwilioConnectionSchema.phoneNumber, to),
      ...(params.MessagingServiceSid ? [eq(salonTwilioConnectionSchema.messagingServiceSid, params.MessagingServiceSid)] : []),
    ),
  )).limit(2);
  const connection = connections.length === 1 ? connections[0] : undefined;
  if (!connection || (params.MessagingServiceSid && connection.messagingServiceSid && params.MessagingServiceSid !== connection.messagingServiceSid)) {
    return new Response('Unknown receiving identity', { status: 403 });
  }
  const body = (params.Body || '').trim();
  const optOutType = (params.OptOutType || '').trim().toUpperCase();
  const keyword = classifyKeyword(body.toUpperCase(), optOutType);
  const now = new Date();
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(smsInboundEventSchema).values({
      id: `sie_${crypto.randomUUID()}`,
      attributedSalonId: connection.salonId,
      senderIdentity: `byo:${connection.connectAccountSid}`,
      fromRecipient: from,
      toNumber: to,
      keywordClassification: keyword,
      attributionState: 'attributed',
      bodyPresent: body.length > 0,
      segmentCount: Number.parseInt(params.NumSegments || '', 10) || null,
      providerSid,
      receivedAt: now,
    }).onConflictDoNothing().returning();
    if (inserted.length === 0 || !['stop', 'cancel', 'start'].includes(keyword)) {
      return;
    }
    const isStop = keyword !== 'start';
    await tx.insert(communicationConsentSchema).values({
      id: `twilio:${providerSid}`,
      salonId: connection.salonId,
      recipient: from,
      channel: 'sms',
      purpose: 'appointment_transactional',
      status: isStop ? 'revoked' : 'granted',
      wordingVersion: isStop ? 'twilio-stop-v1' : 'twilio-start-v1',
      source: 'twilio_inbound',
      grantedAt: isStop ? null : now,
      revokedAt: isStop ? now : null,
      metadata: { keyword: body.toUpperCase(), optOutType: optOutType || null },
    }).onConflictDoNothing();
  });
  return new Response(EMPTY_TWIML, { headers: TWIML_HEADERS });
}
