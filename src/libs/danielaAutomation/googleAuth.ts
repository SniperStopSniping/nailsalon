import 'server-only';

import { createPrivateKey, createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

type GoogleCredentials =
  | { kind: 'serviceAccount'; clientEmail: string; privateKey: string }
  | { kind: 'oauth'; clientId: string; clientSecret: string; refreshToken: string };

function credentials(): GoogleCredentials | null {
  const serviceAccount = process.env.DANIELA_GOOGLE_SERVICE_ACCOUNT_JSON;
  // An explicitly configured service account is authoritative. Invalid keys
  // must not silently fall back to a broader, older user authorization.
  if (serviceAccount) {
    try {
      const value = JSON.parse(serviceAccount) as Record<string, unknown>;
      if (value.type !== 'service_account'
        || typeof value.client_email !== 'string'
        || !/^[\w.-]+@[\w-]+\.iam\.gserviceaccount\.com$/u.test(value.client_email)
        || typeof value.private_key !== 'string') {
        return null;
      }
      const key = createPrivateKey(value.private_key);
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
        return null;
      }
      return { kind: 'serviceAccount', clientEmail: value.client_email, privateKey: value.private_key };
    } catch {
      return null;
    }
  }
  const clientId = process.env.DANIELA_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.DANIELA_GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.DANIELA_GOOGLE_REFRESH_TOKEN;
  return clientId && clientSecret && refreshToken
    ? { kind: 'oauth', clientId, clientSecret, refreshToken }
    : null;
}

export function hasGoogleCredentials(): boolean {
  return credentials() !== null;
}

/** Service accounts use explicit file sharing, with no user impersonation. */
export async function googleToken(): Promise<string> {
  const config = credentials();
  if (!config) {
    throw new Error('SHEETS_NOT_CONFIGURED');
  }
  let body: URLSearchParams;
  if (config.kind === 'serviceAccount') {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: config.clientEmail,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })).toString('base64url');
    const unsigned = `${header}.${payload}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(config.privateKey, 'base64url');
    body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    });
  } else {
    body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    });
  }
  try {
    // Never trust endpoints supplied by downloaded credential JSON.
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error('SHEETS_AUTH_FAILED');
    }
    const data = await response.json() as { access_token?: unknown };
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('SHEETS_AUTH_FAILED');
    }
    return data.access_token;
  } catch {
    // Provider bodies and network errors can contain credentials. Keep the
    // persisted integration failure free of provider response content.
    throw new Error('SHEETS_AUTH_FAILED');
  }
}
