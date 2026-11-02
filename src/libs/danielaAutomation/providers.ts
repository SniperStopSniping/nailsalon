import 'server-only';

import twilio from 'twilio';

import type { DanielaConfig } from './config';
import type { Send } from './store';

export async function sendSms(config: DanielaConfig, item: Send): Promise<{ sid?: string; errorCode?: string; unknown?: boolean }> {
  // A dedicated account/number: never accepts a caller-supplied sender or shared credit override.
  if (config.mode !== 'live' || process.env.VERCEL_ENV !== 'production' || process.env.DANIELA_N8N_CUTOVER_CONFIRMED !== 'true') {
    return { errorCode: 'NOT_LIVE' };
  }
  const client = twilio(config.accountSid, config.authToken, { timeout: 10_000, autoRetry: false });
  try {
    const message = await client.messages.create({
      from: config.fromNumber,
      to: item.phone,
      body: item.body,
      statusCallback: `${config.publicOrigin}/api/private/daniela/status?id=${encodeURIComponent(item.id)}`,
    });
    return /^SM[\da-f]{32}$/iu.test(message.sid || '')
      ? { sid: message.sid }
      : { unknown: true, errorCode: 'PROVIDER_OUTCOME_UNKNOWN' };
  } catch (error) {
    const candidate = error as { code?: unknown; status?: unknown };
    if (typeof candidate?.code === 'number' && typeof candidate.status === 'number' && candidate.status >= 400 && candidate.status < 500) {
      return { errorCode: String(candidate.code) };
    }
    return { unknown: true, errorCode: 'PROVIDER_OUTCOME_UNKNOWN' };
  }
}

export function validateSignature(config: DanielaConfig, request: Request, params: Record<string, string>): boolean {
  const signature = request.headers.get('x-twilio-signature');
  const url = new URL(request.url);
  return !!signature && params.AccountSid === config.accountSid && url.origin === config.publicOrigin
    && twilio.validateRequest(config.authToken, signature, request.url, params);
}

export async function sendTelegram(config: DanielaConfig, text: string): Promise<boolean> {
  const token = process.env.DANIELA_TELEGRAM_BOT_TOKEN;
  if (!token || config.mode !== 'live') {
    return false;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) {
      return false;
    }
    return (await response.json() as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}
