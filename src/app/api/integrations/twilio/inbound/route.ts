/**
 * Twilio inbound webhook — Gate B3 shared/BYO split (contract §10).
 *
 * ONE inbound URL serves both sender modes. The discriminator runs BEFORE
 * any connection lookup: a message is SHARED traffic iff the platform
 * Messaging Service SID is configured AND the inbound carries exactly that
 * SID. Everything else falls through to the LIVE BYO branch, which is
 * byte-identical to the pre-Gate-B route (connection lookup by Connect
 * account SID or salon number, per-salon consent row with metadata).
 *
 * Shared branch rules:
 * - signature validation precedes every mutation (both branches);
 * - STOP/CANCEL/UNSUBSCRIBE/... appends a GLOBAL suppression event keyed on
 *   the logical sender identity — CANCEL is an opt-out keyword ONLY and
 *   never touches an appointment;
 * - START/UNSTOP appends a GLOBAL restore ONLY — the per-salon consent row
 *   must independently be granted (both gates always; §10.1);
 * - ordinary replies mutate nothing, consume no credits, and their BODIES
 *   ARE NEVER STORED (body-present indicator only);
 * - attribution is deterministic or absent: shared-sender intents to this
 *   recipient in the last 72h — exactly one salon attributes, zero is
 *   unattributed, several is ambiguous, never a guess;
 * - every shared inbound leaves an sms_inbound_event evidence row
 *   (provider-SID idempotent; 90-day retention sweep).
 *
 * Twilio Advanced Opt-Out sends the compliance auto-replies (approved copy
 * pinned as ADVANCED_OPT_OUT_COPY); this route always returns empty TwiML.
 */
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import twilio from 'twilio';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import {
  appendGlobalConsentEvent,
  normalizeConsentRecipient,
} from '@/libs/smsConsentShared';
import { LUSTER_DEFAULT_SENDER_IDENTITY } from '@/libs/smsSender';
import {
  communicationConsentSchema,
  communicationIntentSchema,
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
    .where(and(
      eq(communicationIntentSchema.recipient, recipient),
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
  const signature = request.headers.get('x-twilio-signature') || '';
  if (!Env.TWILIO_AUTH_TOKEN || !twilio.validateRequest(Env.TWILIO_AUTH_TOKEN, signature, request.url, params)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Shared/BYO discriminator — BEFORE any connection lookup. BYO Messaging
  // Services have this same URL baked in, so shared traffic is identified
  // positively by the platform's own Messaging Service SID.
  const isSharedTraffic
    = Boolean(Env.TWILIO_MESSAGING_SERVICE_SID)
    && params.MessagingServiceSid === Env.TWILIO_MESSAGING_SERVICE_SID;
  if (isSharedTraffic) {
    return handleSharedInbound(params);
  }

  // ---- LIVE BYO branch: byte-identical to the pre-Gate-B route. ----
  const from = (params.From || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const to = params.To || '';
  const accountSid = params.AccountSid || '';
  const body = (params.Body || '').trim().toUpperCase();
  const optOutType = (params.OptOutType || '').trim().toUpperCase();
  const [connection] = await db.select({ salonId: salonTwilioConnectionSchema.salonId }).from(salonTwilioConnectionSchema).where(or(eq(salonTwilioConnectionSchema.connectAccountSid, accountSid), eq(salonTwilioConnectionSchema.phoneNumber, to))).limit(1);
  const isStop = optOutType === 'STOP' || ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'].includes(body);
  const isStart = optOutType === 'START' || ['START', 'UNSTOP'].includes(body);
  if (connection && (isStop || isStart)) {
    const now = new Date();
    await db.insert(communicationConsentSchema).values({
      id: crypto.randomUUID(),
      salonId: connection.salonId,
      recipient: from,
      channel: 'sms',
      purpose: 'appointment_transactional',
      status: isStop ? 'revoked' : 'granted',
      wordingVersion: isStop ? 'twilio-stop-v1' : 'twilio-start-v1',
      source: 'twilio_inbound',
      grantedAt: isStart ? now : null,
      revokedAt: isStop ? now : null,
      metadata: { keyword: body, optOutType: optOutType || null },
    });
  }
  return new Response(EMPTY_TWIML, { headers: TWIML_HEADERS });
}
