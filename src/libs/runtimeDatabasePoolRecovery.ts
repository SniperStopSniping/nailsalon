import 'server-only';

import type { RuntimeDatabaseGuardError } from './runtimeDatabaseGuard';

// =============================================================================
// Incident hotfix (H2) — warm-runtime recovery.
//
// `src/libs/DB.ts` used to attempt its ONE pool bootstrap at module top
// level, inside a top-level `await`, and THROW on failure. When that attempt
// failed (e.g. Neon returning Postgres `53000`, "exceeded the compute time
// quota"), the module threw during evaluation. A module whose evaluation
// throws never runs its body again for the lifetime of the module registry —
// every later `import { db } from '@/libs/DB'` in that same warm serverless
// instance replayed the same failure, forever, even after the provider
// recovered. Only a redeploy (a fresh process, a fresh module registry)
// could clear it — exactly what was observed in production: `SELECT 1`
// succeeded in 461ms after the Neon quota reset, yet every route kept
// 500ing until redeploy.
//
// A tempting first fix wraps `db` itself in a lazy Proxy that retries on
// access. That is a real bug magnet: Drizzle's chainable builders
// (`db.select().from().where()`) are NOT promises — `.select()` returns a
// builder synchronously, and only the FINAL awaited link triggers a query.
// A Proxy `apply` trap that returns `ensure().then(...)` hands back a
// `Promise`, not a builder, so `.select(...).from` is `undefined` — breaking
// every one of the ~200 chained call sites in this codebase, healthy or not.
// See `DB.recovery.test.ts` for a regression test pinning this shape.
//
// The actual fix needs no proxy at all. `pg-pool` already re-runs the
// per-client `verify` hook (`createRuntimeDatabasePoolVerifier`) on EVERY
// NEW physical connection it makes — not once at pool construction. A Pool
// object that is never destroyed already self-heals: the next query that
// needs a fresh connection re-attempts it, and `verify` re-attests it. The
// ENTIRE poisoning bug was `DB.ts` choosing to `pool.end()` + `throw` on the
// FIRST bootstrap failure. Removing that throw (`DB.ts` now always
// publishes a genuine, real `Pool`/Drizzle handle, never a stand-in) is what
// fixes the warm-runtime recovery — this module's only remaining job is
// bounding HOW OFTEN a failing target may be retried, so a sustained outage
// cannot turn into an unbounded connection storm.
//
// This is deliberately NOT a generic resilience framework: one cooldown
// value, one classify callback, no configurable retry strategies, no
// exponential backoff ladder, no circuit-breaker states.
// =============================================================================

export type RuntimeDatabaseVerificationCooldownOptions = {
  /** Normalizes an unknown failure into the guard's typed, credential-free error. */
  classify: (error: unknown) => RuntimeDatabaseGuardError;
  /** Bounded backoff before a failed attempt may be retried. */
  cooldownMs: number;
  /** Injectable clock for deterministic tests; defaults to Date.now. */
  now?: () => number;
};

export type RuntimeDatabaseVerificationCooldown = {
  /**
   * Gates one live-attestation `attempt` (typically pg-pool's per-new-
   * connection `verify` hook) through a bounded cooldown:
   *   - If a previous attempt failed and the cooldown has not yet elapsed,
   *     rejects immediately — no call to `attempt`, hence no network I/O —
   *     with the SAME classified error the failed attempt produced. This is
   *     what bounds a sustained outage to one attempt per cooldown window
   *     instead of one attempt per incoming connection.
   *   - Otherwise, invokes `attempt` and records its outcome. `attempt`
   *     itself decides whether the target is accepted — this wrapper only
   *     decides WHEN `attempt` may run, never WHETHER its result is
   *     honored. A target that keeps failing attestation (a genuinely wrong
   *     database) keeps being rejected by `attempt` on every single window,
   *     forever.
   *
   * Deliberately NOT single-flighted. An earlier draft shared one in-flight
   * `attempt` across every caller racing it, to collapse a concurrent burst
   * into a single dial-out. That silently broke the invariant this whole
   * module exists to protect: each caller here is pg-pool verifying a
   * DISTINCT new physical connection, so sharing one attempt admits every
   * other connection in the burst on a DIFFERENT connection's attestation —
   * i.e. accepts connections that were never themselves attested. Per-
   * connection attestation is the contract (`createRuntimeDatabasePoolVerifier`),
   * and it must hold for every connection, including ones opened
   * concurrently. The connection burst is already bounded without sharing:
   * pg-pool never opens more than `max` connections at once (2 on Vercel),
   * and the first recorded failure short-circuits everything after it for
   * the whole cooldown window.
   */
  guard: (attempt: () => Promise<void>) => Promise<void>;
};

export function createRuntimeDatabaseVerificationCooldown(
  options: RuntimeDatabaseVerificationCooldownOptions,
): RuntimeDatabaseVerificationCooldown {
  const now = options.now ?? Date.now;

  let lastFailure: { failedAt: number; error: RuntimeDatabaseGuardError } | undefined;

  return {
    guard(attempt) {
      if (lastFailure && now() - lastFailure.failedAt < options.cooldownMs) {
        return Promise.reject(lastFailure.error);
      }

      // Every caller runs its OWN attempt — see the contract note above for
      // why this is not collapsed into a shared in-flight promise.
      return attempt()
        .then(() => {
          lastFailure = undefined;
        })
        .catch((error: unknown) => {
          const classified = options.classify(error);
          lastFailure = { failedAt: now(), error: classified };
          throw classified;
        });
    },
  };
}
