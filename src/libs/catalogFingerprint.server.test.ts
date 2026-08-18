import { describe, expect, it, vi } from 'vitest';

import { canonicalizeCatalogPayload, catalogCanonicalBytes, hashCatalogFingerprintWebCrypto } from './catalogFingerprint';
import { hashCatalogFingerprintNode } from './catalogFingerprint.server';

vi.mock('server-only', () => ({}));

describe('hashCatalogFingerprintNode', () => {
  it('produces a 64-character lowercase hex SHA-256 digest', async () => {
    const digest = await hashCatalogFingerprintNode(catalogCanonicalBytes('hello world'));

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the known SHA-256 test vector for the empty string', async () => {
    const digest = await hashCatalogFingerprintNode(new TextEncoder().encode(''));

    expect(digest).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

/**
 * THE differential test the correction requires: SAME INPUT -> SAME
 * CANONICAL BYTES -> SAME HASH, proven across BOTH environments this
 * fingerprint must agree in. `finalizeCatalogRevision` (`catalogResolverCore.ts`)
 * treats `hashCatalogFingerprintWebCrypto` and `hashCatalogFingerprintNode`
 * as interchangeable — this is what makes that assumption safe.
 */
describe('Web Crypto and Node crypto agree byte-for-byte', () => {
  const cases: Array<[string, unknown]> = [
    ['an empty payload', {}],
    ['a simple flat object', { a: 1, b: 'two', c: true }],
    ['a nested catalog-shaped payload', {
      currency: 'CAD',
      services: [{ id: 'svc_1', priceCents: 5000 }, { id: 'svc_2', priceCents: 3000 }],
      ruleProjections: [{ effect: 'disable', targetAddOnId: 'addon_1' }],
    }],
    ['unicode content', { name: 'Café ☕️ — 日本語' }],
    ['an empty string canonical', ''],
  ];

  it.each(cases)('%s', async (_label, value) => {
    const canonical = typeof value === 'string' ? value : canonicalizeCatalogPayload(value);
    const bytes = catalogCanonicalBytes(canonical);

    const webCryptoDigest = await hashCatalogFingerprintWebCrypto(bytes);
    const nodeDigest = await hashCatalogFingerprintNode(bytes);

    expect(webCryptoDigest).toBe(nodeDigest);
    expect(webCryptoDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('agrees for the exact canonical payload shape catalogResolverCore.ts hashes', async () => {
    const canonical = canonicalizeCatalogPayload({
      currency: 'USD',
      services: [],
      addOnGroups: [],
      addOns: [],
      serviceAddOnBindings: [],
      ruleProjections: [],
    });
    const bytes = catalogCanonicalBytes(canonical);

    expect(await hashCatalogFingerprintWebCrypto(bytes)).toBe(await hashCatalogFingerprintNode(bytes));
  });
});
