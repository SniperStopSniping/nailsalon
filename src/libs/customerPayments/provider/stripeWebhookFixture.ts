import { createHmac, timingSafeEqual } from 'node:crypto';

import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import type { ProviderFixtureConfig, VerifiedProviderReceipt } from './evidence';
import { verifyOfflineProviderReceipt } from './evidence';

/** Public test-vector material only, never a provider webhook secret. */
export type OfflineStripeFixtureSigningBinding = Readonly<{
  endpointId: string;
  platformId: string;
  publicFixtureKey: `public-offline-stripe-fixture:${string}`;
}>;

const invalidConfig = 'CUSTOMER_PAYMENT_STRIPE_FIXTURE_CONFIG_INVALID';

/**
 * Strict offline v1 profile: one canonical timestamp, lowercase SHA-256 hex,
 * at most 300 seconds old and at most 5 seconds ahead of fixed receipt time.
 * Unlike stripe-node 16.12.0, this hashes original bytes without UTF-8 decoding
 * and rejects duplicate/noncanonical timestamps and unbounded future dates.
 */
function authenticate(rawBody: Uint8Array, header: string, key: string, receivedAtMs: number): boolean {
  const fields = header.split(',');
  if (fields.length > 128) {
    return false;
  }
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const field of fields) {
    // Unknown schemes may coexist with v1, but never authenticate by themselves.
    const match = /^([a-z]\w{0,31})=([\w-]{1,512})$/i.exec(field);
    if (!match || match[0] !== field) {
      return false;
    }
    const [, name, value] = match;
    if (name === 't') {
      const seconds = Number(value);
      if (timestamp !== null || !Number.isSafeInteger(seconds) || seconds < 0 || String(seconds) !== value) {
        return false;
      }
      timestamp = seconds;
    } else if (name === 'v1') {
      if (!/^[a-f0-9]{64}$/.test(value!)) {
        return false;
      }
      signatures.push(value!);
    }
  }
  if (timestamp === null || signatures.length === 0) {
    return false;
  }
  const ageSeconds = Math.floor(receivedAtMs / 1000) - timestamp;
  if (ageSeconds > 300 || ageSeconds < -5) {
    return false;
  }
  const expected = createHmac('sha256', key).update(`${timestamp}.`, 'utf8').update(rawBody).digest();
  let matched = false;
  for (const signature of signatures) {
    // Validate every v1 candidate, including after a match, with equal byte sizes.
    matched = timingSafeEqual(expected, Buffer.from(signature, 'hex')) || matched;
  }
  return matched;
}

/**
 * Stripe wire-protocol fixture rehearsal, not Stripe-origin or financial proof.
 * No SDK/client, credentials, endpoint discovery or network callback is used.
 * Endpoint/platform identity comes only from the explicit signing binding.
 * Authentication precedes existing normalization: signed malformed/unsupported
 * payloads remain offline review receipts, with unchanged provenance and holds.
 */
export async function verifyOfflineStripeWebhookReceipt(
  input: { rawBody: Uint8Array; signature: string; receivedAt: Date },
  config: ProviderFixtureConfig,
  signingBinding: OfflineStripeFixtureSigningBinding,
): Promise<VerifiedProviderReceipt> {
  // Disabled execution must not inspect supplied bytes, configuration or key.
  requireCustomerPaymentProviderFixtureEnabled();
  let rawBody: Uint8Array;
  let signature: string;
  let receivedAt: Date;
  let fixed: ProviderFixtureConfig;
  let binding: OfflineStripeFixtureSigningBinding;
  try {
    const suppliedBody = input.rawBody;
    const suppliedTime = input.receivedAt;
    signature = input.signature;
    const receivedAtMs = suppliedTime instanceof Date ? Date.prototype.getTime.call(suppliedTime) : Number.NaN;
    if (!(suppliedBody instanceof Uint8Array) || suppliedBody.byteLength === 0 || suppliedBody.byteLength > 1024 * 1024
      || !Number.isSafeInteger(receivedAtMs) || receivedAtMs < 0
      || typeof signature !== 'string' || signature.length === 0 || signature.length > 8192) {
      throw new Error(invalidConfig);
    }
    rawBody = Uint8Array.from(suppliedBody);
    receivedAt = new Date(receivedAtMs);
    const expectedObject = config.expectedObject;
    fixed = { ...config, expectedObject: expectedObject ? { ...expectedObject } : undefined };
    binding = {
      endpointId: signingBinding.endpointId,
      platformId: signingBinding.platformId,
      publicFixtureKey: signingBinding.publicFixtureKey,
    };
    // This offline contract deliberately pins the existing reviewed API version.
    // Do not import the credential-backed global Stripe client to read its pin.
    if (fixed.apiVersion !== '2024-06-20' || fixed.livemode !== false
      || binding.endpointId !== fixed.endpointId || binding.platformId !== fixed.platformId
      || typeof binding.publicFixtureKey !== 'string'
      || /^public-offline-stripe-fixture:[\w-]{1,128}$/.exec(binding.publicFixtureKey)?.[0] !== binding.publicFixtureKey) {
      throw new Error(invalidConfig);
    }
  } catch {
    // Do not expose input/getter errors containing key, signature or payload data.
    throw new Error(invalidConfig);
  }
  // No separate verifier API: the signature clock and receipt time cannot diverge.
  // The existing boundary validates configuration, snapshots again, and rechecks
  // the fixture gate after awaiting this internal verifier before minting a receipt.
  return verifyOfflineProviderReceipt({ rawBody, signature, receivedAt }, fixed, verifiedInput =>
    verifiedInput.endpointId === binding.endpointId && verifiedInput.platformId === binding.platformId
    && authenticate(verifiedInput.rawBody, verifiedInput.signature, binding.publicFixtureKey, receivedAt.getTime()));
}
