/**
 * Luster L1 PR3 — canonical serialization and browser-side SHA-256 hashing
 * for the catalog revision fingerprint.
 *
 * PURE and BROWSER-COMPATIBLE: no `@/libs/DB`, no `server-only`, no
 * `node:crypto`. `stableStringify`/`canonicalizeCatalogPayload` are
 * synchronous — `catalogResolverCore.ts`'s `buildPublicCatalogSnapshot`
 * calls them directly. `hashCatalogFingerprintWebCrypto` is asynchronous by
 * necessity: `crypto.subtle.digest` has no synchronous form in a browser.
 * That is why hashing is a SEPARATE step from snapshot building — see
 * `finalizeCatalogRevision` in `catalogResolverCore.ts` — rather than
 * something the (synchronous) core does itself.
 *
 * This fingerprint GATES A CONCURRENCY/CONFLICT DECISION at submission time
 * (has the catalog a client is booking against changed since it loaded?).
 * That is a correctness-and-safety-relevant use, not a cosmetic cache key —
 * which is why it must be SHA-256, not a fast non-cryptographic hash. See
 * `catalogFingerprint.server.test.ts` for the differential test proving the
 * browser (Web Crypto) and server (Node `crypto`) paths agree byte-for-byte.
 *
 * `catalogResolverCore.ts`'s `PublicCatalogRuleProjection.projectionKey` is a
 * DIFFERENT, lower-stakes concern — an opaque, stable correlation key for one
 * rule's projection, never used for a conflict decision — and is built by a
 * plain deterministic string encoding in that file, not by hashing at all.
 * Conflating the two would either weaken this fingerprint or force the
 * synchronous core to await a hash on every snapshot build; keeping them
 * separate avoids both.
 */

/**
 * Recursively sorts object keys so `JSON.stringify` is deterministic
 * regardless of construction order. Arrays keep their order — order is
 * caller-controlled and already meaningful (e.g. display order).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const sorted: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      sorted[key] = sortKeysDeep(entryValue);
    }
    return sorted;
  }
  return value;
}

/** Named entry point for "canonicalize the complete public semantic model" — a thin, self-documenting alias over `stableStringify` for call sites that hash the result. */
export function canonicalizeCatalogPayload(value: unknown): string {
  return stableStringify(value);
}

/** UTF-8 bytes of a canonical string. Both hashers below consume the SAME bytes produced by this one function, so "same canonical bytes -> same hash" is actually testable rather than assumed. */
export function catalogCanonicalBytes(canonical: string): Uint8Array {
  return new TextEncoder().encode(canonical);
}

/** Lowercase hex encoding of a digest, shared by both the Web Crypto and Node `crypto` paths so their OUTPUT FORMAT can never be the source of a mismatch. */
export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 via the Web Crypto API (`crypto.subtle`) — the browser path, and
 * also available under plain Node (18+) and Vitest without any server-only
 * import, since `globalThis.crypto.subtle` is a standard Web Platform API,
 * not a Node builtin. Async because `subtle.digest` has no synchronous form.
 */
export async function hashCatalogFingerprintWebCrypto(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(digest);
}
