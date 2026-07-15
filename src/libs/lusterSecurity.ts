import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { Env } from '@/libs/Env';

const ENCRYPTION_FORMAT = 'luster-aes-256-gcm';

function getEncryptionKey(): Buffer {
  const configured = Env.INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!configured && Env.NODE_ENV === 'production') {
    throw new Error('INTEGRATION_ENCRYPTION_KEY is required in production');
  }

  const source = configured || `development:${Env.CLERK_SECRET_KEY}`;
  return createHash('sha256').update(source).digest();
}

function getStateSecret(): string {
  const configured = Env.OAUTH_STATE_SECRET?.trim();
  if (!configured && Env.NODE_ENV === 'production') {
    throw new Error('OAUTH_STATE_SECRET is required in production');
  }
  return configured || `development:${Env.CLERK_SECRET_KEY}`;
}

export function createOpaqueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function encryptIntegrationSecret(plaintext: string): {
  ciphertext: string;
  keyVersion: number;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const keyVersion = Env.INTEGRATION_ENCRYPTION_KEY_VERSION ?? 1;
  return {
    ciphertext: [ENCRYPTION_FORMAT, String(keyVersion), iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.'),
    keyVersion,
  };
}

export function decryptIntegrationSecret(ciphertext: string): string {
  const [format, _version, ivValue, tagValue, encryptedValue] = ciphertext.split('.');
  if (format !== ENCRYPTION_FORMAT || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Unsupported encrypted integration secret');
  }

  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function signOAuthState(payload: Record<string, unknown>, ttlSeconds = 600): string {
  const encoded = Buffer.from(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: randomBytes(16).toString('base64url'),
  })).toString('base64url');
  const signature = createHmac('sha256', getStateSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyOAuthState<T extends Record<string, unknown>>(state: string): T {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) {
    throw new Error('Invalid OAuth state');
  }

  const expected = createHmac('sha256', getStateSecret()).update(encoded).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Invalid OAuth state signature');
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T & { exp?: number };
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('OAuth state has expired');
  }
  return payload;
}
