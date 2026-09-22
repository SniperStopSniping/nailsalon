import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import twilio from 'twilio';

import type { VoiceRuntimeConfig } from './config.server';

function sameBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function voiceTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Reproducible for an authenticated Twilio retry, bound once to a Live session in storage. */
export function voiceRouteToken(call: { id: string; salonId: string; providerCallId: string; routeExpiresAt: Date }, secret: string): string {
  return `${call.id}.${createHmac('sha256', secret).update(JSON.stringify(['luster.voice.route.v1', call.id, call.salonId, call.providerCallId, call.routeExpiresAt.toISOString()])).digest('base64url')}`;
}

export function verifyVoiceTwilio(request: Request, params: Record<string, string>, config: VoiceRuntimeConfig): boolean {
  const signature = request.headers.get('x-twilio-signature');
  const url = new URL(request.url);
  if (!signature || params.AccountSid !== config.twilioAccountSid) {
    return false;
  }
  // The canonical public origin is configured, never selected by forwarding headers.
  return twilio.validateRequest(config.twilioAuthToken, signature, `${config.origin}${url.pathname}${url.search}`, params);
}

/** OpenAI uses Standard Webhooks: authenticate the exact raw body before parsing it. */
export function verifyVoiceOpenAiWebhook(body: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatures = headers.get('webhook-signature');
  if (!id || !timestamp || !/^\d+$/.test(timestamp) || !signatures || Math.abs(now / 1000 - Number(timestamp)) > 300) {
    return false;
  }
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  if (key.length < 16) {
    return false;
  }
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.split(' ').some((candidate) => {
    const [version, signature] = candidate.split(',');
    return version === 'v1' && !!signature && sameBytes(expected, Buffer.from(signature, 'base64'));
  });
}

export function voiceRouteFromSipHeaders(headers: unknown): string | null {
  if (!Array.isArray(headers) || headers.length > 100) {
    return null;
  }
  const matching = headers.filter(header => header && typeof header.name === 'string' && header.name.toLowerCase() === 'x-luster-route');
  if (matching.length !== 1 || typeof matching[0].value !== 'string' || !/^[0-9a-f-]{36}\.[\w-]{43}$/.test(matching[0].value)) {
    return null;
  }
  return matching[0].value;
}

export async function readVoiceBody(request: Request, limit = 65_536): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > limit || !request.body) {
    return null;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

/** Parses Twilio's small form payload once, rejecting ambiguous repeated keys. */
export async function readVoiceForm(request: Request): Promise<Record<string, string> | null> {
  const body = await readVoiceBody(request, 16_384);
  if (body === null) {
    return null;
  }
  const values: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of new URLSearchParams(body)) {
    if (++count > 40 || !/^[A-Z]\w{0,99}$/i.test(key) || value.length > 2_000 || Object.hasOwn(values, key)) {
      return null;
    }
    values[key] = value;
  }
  return values;
}
