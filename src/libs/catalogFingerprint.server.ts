import 'server-only';

import { createHash } from 'node:crypto';

/**
 * Luster L1 PR3 — server-side SHA-256 hashing for the catalog revision
 * fingerprint, via Node's `crypto`. The `.server.ts` split mirrors
 * `depositPolicy.ts` / `depositPolicy.server.ts`: the browser-safe half
 * (`catalogFingerprint.ts`, Web Crypto) must never import `node:crypto`, and
 * this file must never be reachable from a client bundle. `import
 * 'server-only'` enforces the second half of that at build time.
 *
 * `createHash(...).digest()` is synchronous in Node, but this is exposed as
 * `async` anyway so a caller can use either this or the Web Crypto path
 * behind the identical `(bytes: Uint8Array) => Promise<string>` shape —
 * see `finalizeCatalogRevision` in `catalogResolverCore.ts`, which takes
 * exactly that shape and does not care which environment supplied it.
 */
export async function hashCatalogFingerprintNode(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}
