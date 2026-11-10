import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPaymentReturnUrl, paymentReturnSigningKeyHash, verifyPaymentReturnToken } from './paymentReturnToken';

vi.mock('server-only', () => ({}));
const scope = { salonId: 'salon_fixture', appointmentId: 'appointment_fixture' };
const now = Date.now();
const binding = { platformAccountId: 'acct_platform', connectedAccountId: 'acct_connected', bindingId: 'binding_fixture', livemode: false, currency: 'cad' as const, returnOrigin: 'https://preview.example.invalid' };

beforeEach(() => vi.stubEnv('CUSTOMER_PAYMENTS_STATUS_SIGNING_SECRET', 'synthetic-return-status-fixture-'.repeat(2)));

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  const operation = { id: randomUUID(), kind: 'payment' as const, binding, createdAt: now, returnStatusKeyHash: paymentReturnSigningKeyHash()! };
  const url = new URL(createPaymentReturnUrl(scope, operation));
  const token = new URLSearchParams(url.hash.slice(1)).get('status')!;
  return { operation, url, token };
}

describe('limited payment return capability', () => {
  it('keeps a deterministic status capability out of page query strings', () => {
    const f = fixture();

    expect(f.url.search).toBe('');
    expect(createPaymentReturnUrl(scope, f.operation)).toBe(f.url.toString());
    expect(verifyPaymentReturnToken(f.token, binding.returnOrigin, now)).toMatchObject({ ...scope, operationId: f.operation.id });
    expect(f.url.toString()).not.toContain(process.env.CUSTOMER_PAYMENTS_STATUS_SIGNING_SECRET);
  });

  it('rejects expiry, future issuance, wrong deployment and altered signed scope', () => {
    const f = fixture();
    const [payload, signature] = f.token.split('.');
    const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), salonId: 'another_salon' })).toString('base64url');

    expect(verifyPaymentReturnToken(f.token, binding.returnOrigin, now + 7 * 86400000)).toBeNull();
    expect(verifyPaymentReturnToken(f.token, binding.returnOrigin, now - 1)).toBeNull();
    expect(verifyPaymentReturnToken(f.token, 'https://another.example.invalid', now)).toBeNull();
    expect(verifyPaymentReturnToken(`${altered}.${signature}`, binding.returnOrigin, now)).toBeNull();
    expect(verifyPaymentReturnToken(`${f.token}extra`, binding.returnOrigin, now)).toBeNull();
  });

  it('refuses missing/rotated keys and refund operations before changing retry URLs', () => {
    const f = fixture();

    expect(() => createPaymentReturnUrl(scope, { ...f.operation, kind: 'refund' })).toThrow('RETURN_CONFIGURATION_CHANGED');

    vi.stubEnv('CUSTOMER_PAYMENTS_STATUS_SIGNING_SECRET', 'another-synthetic-return-status-key-'.repeat(2));

    expect(() => createPaymentReturnUrl(scope, f.operation)).toThrow('RETURN_CONFIGURATION_CHANGED');
    expect(verifyPaymentReturnToken(f.token, binding.returnOrigin, now)).toBeNull();

    vi.stubEnv('CUSTOMER_PAYMENTS_STATUS_SIGNING_SECRET', '');

    expect(paymentReturnSigningKeyHash()).toBeNull();
    expect(() => createPaymentReturnUrl(scope, f.operation)).toThrow('RETURN_CONFIGURATION_CHANGED');
  });
});
