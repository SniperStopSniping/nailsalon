import { describe, expect, it } from 'vitest';

import {
  bytesToHex,
  canonicalizeCatalogPayload,
  catalogCanonicalBytes,
  hashCatalogFingerprintWebCrypto,
  stableStringify,
} from './catalogFingerprint';

describe('stableStringify', () => {
  it('produces the same output regardless of key construction order', () => {
    const a = { z: 1, a: 2, m: { y: 1, b: 2 } };
    const b = { a: 2, z: 1, m: { b: 2, y: 1 } };

    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('preserves array order (order is meaningful, unlike object keys)', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
});

describe('canonicalizeCatalogPayload', () => {
  it('is the same canonicalization stableStringify produces', () => {
    const value = { b: 2, a: 1 };

    expect(canonicalizeCatalogPayload(value)).toBe(stableStringify(value));
  });
});

describe('catalogCanonicalBytes', () => {
  it('produces the UTF-8 bytes of the canonical string', () => {
    const bytes = catalogCanonicalBytes('{"a":1}');

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
  });

  it('is deterministic for the same canonical string', () => {
    const first = catalogCanonicalBytes('same input');
    const second = catalogCanonicalBytes('same input');

    expect(first).toEqual(second);
  });
});

describe('bytesToHex', () => {
  it('encodes bytes as lowercase hex', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });

  it('accepts a raw ArrayBuffer, not just a Uint8Array', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;

    expect(bytesToHex(buffer)).toBe('010203');
  });
});

describe('hashCatalogFingerprintWebCrypto', () => {
  it('produces a 64-character lowercase hex SHA-256 digest', async () => {
    const digest = await hashCatalogFingerprintWebCrypto(catalogCanonicalBytes('hello world'));

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same bytes', async () => {
    const bytes = catalogCanonicalBytes(canonicalizeCatalogPayload({ services: ['a', 'b'], rev: 1 }));
    const first = await hashCatalogFingerprintWebCrypto(bytes);
    const second = await hashCatalogFingerprintWebCrypto(bytes);

    expect(first).toBe(second);
  });

  it('changes when the underlying content changes', async () => {
    const first = await hashCatalogFingerprintWebCrypto(catalogCanonicalBytes(canonicalizeCatalogPayload({ services: ['a'] })));
    const second = await hashCatalogFingerprintWebCrypto(catalogCanonicalBytes(canonicalizeCatalogPayload({ services: ['a', 'b'] })));

    expect(first).not.toBe(second);
  });

  it('is independent of object key construction order (hashes the CANONICAL form)', async () => {
    const a = catalogCanonicalBytes(canonicalizeCatalogPayload({ z: 1, a: 2 }));
    const b = catalogCanonicalBytes(canonicalizeCatalogPayload({ a: 2, z: 1 }));

    expect(await hashCatalogFingerprintWebCrypto(a)).toBe(await hashCatalogFingerprintWebCrypto(b));
  });

  it('matches a known SHA-256 test vector (empty string)', async () => {
    const digest = await hashCatalogFingerprintWebCrypto(new TextEncoder().encode(''));

    expect(digest).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
