import { generateKeyPairSync, verify } from 'node:crypto';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getDanielaConfig } from './config';
import { googleToken, hasGoogleCredentials } from './googleAuth';

vi.mock('server-only', () => ({}));

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  type: 'service_account',
  client_email: 'synthetic-sheets@synthetic-project.iam.gserviceaccount.com',
  private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://untrusted.example.test/token',
};

beforeEach(() => {
  for (const name of ['DANIELA_GOOGLE_SERVICE_ACCOUNT_JSON', 'DANIELA_GOOGLE_CLIENT_ID', 'DANIELA_GOOGLE_CLIENT_SECRET', 'DANIELA_GOOGLE_REFRESH_TOKEN']) {
    vi.stubEnv(name, '');
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('signs a Sheets-only assertion with the configured RSA key and fixed Google audience', async () => {
  vi.stubEnv('DANIELA_GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify(serviceAccount));
  const fetcher = vi.fn(async () => Response.json({ access_token: 'synthetic-token' }));
  vi.stubGlobal('fetch', fetcher);
  const before = Math.floor(Date.now() / 1000);

  await expect(googleToken()).resolves.toBe('synthetic-token');

  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const body = init.body as URLSearchParams;
  const [header, payload, signature] = body.get('assertion')!.split('.') as [string, string, string];
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());

  expect(url).toBe('https://oauth2.googleapis.com/token');
  expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
  expect(claims).toEqual({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: expect.any(Number),
    exp: expect.any(Number),
  });
  expect(claims.iat).toBeGreaterThanOrEqual(before);
  expect(claims.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  expect(claims.exp - claims.iat).toBe(3600);
  expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
});

it('retains the dedicated OAuth refresh-token connection', async () => {
  vi.stubEnv('DANIELA_GOOGLE_CLIENT_ID', 'synthetic-client');
  vi.stubEnv('DANIELA_GOOGLE_CLIENT_SECRET', 'synthetic-secret');
  vi.stubEnv('DANIELA_GOOGLE_REFRESH_TOKEN', 'synthetic-refresh');
  const fetcher = vi.fn(async () => Response.json({ access_token: 'synthetic-token' }));
  vi.stubGlobal('fetch', fetcher);

  await expect(googleToken()).resolves.toBe('synthetic-token');

  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];

  expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
    client_id: 'synthetic-client',
    client_secret: 'synthetic-secret',
    refresh_token: 'synthetic-refresh',
    grant_type: 'refresh_token',
  });
});

it.each(['not JSON', 'null', JSON.stringify({ ...serviceAccount, private_key: 'invalid-key' }), JSON.stringify({ ...serviceAccount, type: 'authorized_user' })])('rejects invalid service-account configuration without falling back to OAuth: %s', async (value) => {
  vi.stubEnv('DANIELA_GOOGLE_SERVICE_ACCOUNT_JSON', value);
  vi.stubEnv('DANIELA_GOOGLE_CLIENT_ID', 'synthetic-client');
  vi.stubEnv('DANIELA_GOOGLE_CLIENT_SECRET', 'synthetic-secret');
  vi.stubEnv('DANIELA_GOOGLE_REFRESH_TOKEN', 'synthetic-refresh');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);

  expect(hasGoogleCredentials()).toBe(false);
  await expect(googleToken()).rejects.toThrow('SHEETS_NOT_CONFIGURED');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  async () => Response.json({ error: 'synthetic-secret' }, { status: 401 }),
  async () => Response.json({ access_token: 123 }),
  async () => {
    throw new Error('synthetic-secret');
  },
])('sanitizes failed token responses', async (fetcher) => {
  vi.stubEnv('DANIELA_GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify(serviceAccount));
  vi.stubGlobal('fetch', fetcher);

  await expect(googleToken()).rejects.toThrow(/^SHEETS_AUTH_FAILED$/u);
});

it('allows live mode with a valid service account only after all existing cutover gates pass', () => {
  vi.stubEnv('DANIELA_GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify(serviceAccount));
  vi.stubEnv('DANIELA_AUTOMATION_MODE', 'live');
  vi.stubEnv('DANIELA_AUTOMATION_CONFIG', JSON.stringify({
    salonId: 'synthetic-isla',
    accountSid: `AC${'a'.repeat(32)}`,
    fromNumber: '+14165550101',
    publicOrigin: 'https://example.test',
    greeting: 'Synthetic greeting',
    bookingMessage: 'Synthetic booking link',
    promoMessage: 'Synthetic promotion',
    blockedPhones: [],
    preferredPhones: [],
    telegramChatId: '1',
    sheets: [{ spreadsheetId: 'main', tab: 'Sheet1', role: 'primary' }, { spreadsheetId: 'copy', tab: 'CRM', role: 'inbound' }],
  }));
  vi.stubEnv('DANIELA_TWILIO_AUTH_TOKEN', 'synthetic');
  vi.stubEnv('DANIELA_TELEGRAM_BOT_TOKEN', 'synthetic');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('DANIELA_N8N_CUTOVER_CONFIRMED', '');

  expect(getDanielaConfig()).toBeNull();

  vi.stubEnv('DANIELA_N8N_CUTOVER_CONFIRMED', 'true');

  expect(getDanielaConfig()?.mode).toBe('live');

  vi.stubEnv('VERCEL_ENV', 'preview');

  expect(getDanielaConfig()).toBeNull();

  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('DANIELA_GOOGLE_SERVICE_ACCOUNT_JSON', 'invalid');

  expect(getDanielaConfig()).toBeNull();
});
