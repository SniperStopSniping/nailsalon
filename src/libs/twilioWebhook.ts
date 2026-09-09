import 'server-only';

import { eq } from 'drizzle-orm';
import twilio from 'twilio';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { salonTwilioConnectionSchema } from '@/models/Schema';

const TOKEN_CACHE_TTL_MS = 60_000;
const MAX_CACHED_ACCOUNTS = 100;
const tokenCache = new Map<string, { token: string | null; expiresAt: number }>();
const pendingLookups = new Map<string, Promise<string | null>>();

/** Fetch only a known connected account's signing token; never persist or log it. */
async function connectedSigningToken(accountSid: string): Promise<string | null> {
  const cached = tokenCache.get(accountSid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  const pending = pendingLookups.get(accountSid);
  if (pending) {
    return pending;
  }
  const lookup = (async () => {
    const [connection] = await db.select({ salonId: salonTwilioConnectionSchema.salonId })
      .from(salonTwilioConnectionSchema)
      .where(eq(salonTwilioConnectionSchema.connectAccountSid, accountSid)).limit(1);
    if (!connection) {
      return null;
    }
    let token: string | null = null;
    try {
      const client = twilio(accountSid, Env.TWILIO_AUTH_TOKEN, { timeout: 5_000, autoRetry: false });
      const account = await client.api.v2010.accounts(accountSid).fetch();
      token = account.sid === accountSid && account.authToken ? account.authToken : null;
    } catch {
      // Missing Connect read permission, revoked access or provider failure
      // must fail closed. A short negative cache bounds repeated API failures.
    }
    if (tokenCache.size >= MAX_CACHED_ACCOUNTS) {
      const oldest = tokenCache.keys().next().value;
      if (oldest) {
        tokenCache.delete(oldest);
      }
    }
    tokenCache.set(accountSid, { token, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
    return token;
  })();
  pendingLookups.set(accountSid, lookup);
  try {
    return await lookup;
  } finally {
    pendingLookups.delete(accountSid);
  }
}

/** Shared/Connect callbacks use provider signatures; no unsigned fallback exists. */
export async function validateTwilioWebhook(
  request: Request,
  params: Record<string, string>,
): Promise<boolean> {
  const signature = request.headers.get('x-twilio-signature');
  const platformToken = Env.TWILIO_AUTH_TOKEN;
  if (!signature || !platformToken) {
    return false;
  }
  if (twilio.validateRequest(platformToken, signature, request.url, params)) {
    return true;
  }
  // Subaccount-originated callbacks may be signed using the originating
  // account's token, even when Connect sends authenticate with our app token.
  const accountSid = params.AccountSid || params.account_sid || '';
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || accountSid === Env.TWILIO_ACCOUNT_SID) {
    return false;
  }
  const accountToken = await connectedSigningToken(accountSid);
  return !!accountToken && twilio.validateRequest(accountToken, signature, request.url, params);
}
