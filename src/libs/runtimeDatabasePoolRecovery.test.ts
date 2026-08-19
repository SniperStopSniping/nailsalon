import { describe, expect, it, vi } from 'vitest';

import { RuntimeDatabaseGuardError } from './runtimeDatabaseGuard';
import { createRuntimeDatabaseVerificationCooldown } from './runtimeDatabasePoolRecovery';

vi.mock('server-only', () => ({}));

/**
 * H2 — warm-runtime recovery, tested in isolation from `pg`/Drizzle/Neon.
 *
 * `createRuntimeDatabaseVerificationCooldown` gates how often pg-pool's
 * per-new-connection `verify` hook may actually run against the network
 * during a sustained outage, WITHOUT ever standing in for the connection
 * itself — no proxy, no stand-in `db`. Every scenario below is driven with
 * a fake clock and an injected `attempt`, so it runs deterministically with
 * no real network I/O.
 */

function unavailable(): RuntimeDatabaseGuardError {
  return new RuntimeDatabaseGuardError('DATABASE_UNAVAILABLE');
}

function attestationRejected(): RuntimeDatabaseGuardError {
  return new RuntimeDatabaseGuardError('DATABASE_ATTESTATION_REJECTED');
}

/** A controllable fake clock — `advance` moves it forward for cooldown tests. */
function fakeClock(startAt = 0) {
  let current = startAt;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('createRuntimeDatabaseVerificationCooldown', () => {
  it('rejects safely on the initial provider failure', async () => {
    const clock = fakeClock();
    const attempt = vi.fn().mockRejectedValue(new Error('connection refused'));
    const cooldown = createRuntimeDatabaseVerificationCooldown({
      classify: unavailable,
      cooldownMs: 1000,
      now: clock.now,
    });

    await expect(cooldown.guard(attempt)).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('blocks a retry during the cooldown window without calling attempt again', async () => {
    const clock = fakeClock();
    const attempt = vi.fn().mockRejectedValue(new Error('connection refused'));
    const cooldown = createRuntimeDatabaseVerificationCooldown({
      classify: unavailable,
      cooldownMs: 5000,
      now: clock.now,
    });

    await expect(cooldown.guard(attempt)).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });

    clock.advance(4999);

    await expect(cooldown.guard(attempt)).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });

    // Still exactly one real attempt — the second call was served from the
    // cached failure, never touching the network. This is what prevents a
    // per-connection storm during a real outage.
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('provider recovers: a bounded retry after the cooldown succeeds', async () => {
    const clock = fakeClock();
    const attempt = vi.fn()
      .mockRejectedValueOnce(new Error('exceeded the compute time quota'))
      .mockResolvedValue(undefined);
    const cooldown = createRuntimeDatabaseVerificationCooldown({
      classify: unavailable,
      cooldownMs: 5000,
      now: clock.now,
    });

    await expect(cooldown.guard(attempt)).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });

    clock.advance(5000);

    await expect(cooldown.guard(attempt)).resolves.toBeUndefined();
    expect(attempt).toHaveBeenCalledTimes(2);

    // And the cooldown is cleared — the very next call runs immediately too,
    // no stale failure lingering after a success.
    clock.advance(1);

    await expect(cooldown.guard(attempt)).resolves.toBeUndefined();
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('wrong DB stays rejected after the retry interval — cooldown never turns a rejected identity into an accepted one', async () => {
    const clock = fakeClock();
    // Unlike the availability case, this simulates an `attempt` that keeps
    // discovering the SAME wrong database every time — exactly what a real
    // attestation check does, since the connection string never changes
    // without a redeploy.
    const attempt = vi.fn().mockRejectedValue(new Error('non-Production marker present'));
    const cooldown = createRuntimeDatabaseVerificationCooldown({
      classify: attestationRejected,
      cooldownMs: 1000,
      now: clock.now,
    });

    await expect(cooldown.guard(attempt)).rejects.toMatchObject({
      code: 'DATABASE_ATTESTATION_REJECTED',
    });

    // Advance past several cooldown windows — a real deployment could sit in
    // this state for hours.
    for (let i = 0; i < 5; i += 1) {
      clock.advance(1000);

      await expect(cooldown.guard(attempt)).rejects.toMatchObject({
        code: 'DATABASE_ATTESTATION_REJECTED',
      });
    }

    // Every cooldown boundary really did trigger a fresh attempt (bounded
    // retry, not just the first one) — and every single one still failed
    // attestation. attempt() was called once per elapsed window (6 total:
    // the initial call plus 5 retries), never fewer (proving retries do
    // happen) and never accepted (proving attestation is never bypassed).
    expect(attempt).toHaveBeenCalledTimes(6);
  });

  it('concurrent callers are each attested individually — one connection is never admitted on another connection\'s attestation', async () => {
    const clock = fakeClock();
    const releases: Array<() => void> = [];
    const attempt = vi.fn(() => new Promise<void>((resolve) => {
      releases.push(resolve);
    }));
    const cooldown = createRuntimeDatabaseVerificationCooldown({
      classify: unavailable,
      cooldownMs: 1000,
      now: clock.now,
    });

    // Each caller here is pg-pool verifying a DISTINCT new physical
    // connection. Collapsing them into one shared in-flight attempt (an
    // earlier draft did) would admit 24 connections that were never
    // themselves attested — the exact invariant
    // createRuntimeDatabasePoolVerifier exists to hold.
    const callers = Array.from({ length: 25 }, () => cooldown.guard(attempt));
    await Promise.resolve();
    await Promise.resolve();

    expect(attempt).toHaveBeenCalledTimes(25);

    releases.forEach(release => release());

    await expect(Promise.all(callers)).resolves.toHaveLength(25);
    expect(attempt).toHaveBeenCalledTimes(25);
  });

  it('a recorded failure still short-circuits a concurrent burst — the storm bound survives per-caller attestation', async () => {
    const clock = fakeClock();
    const attempt = vi.fn().mockRejectedValue(new Error('exceeded the compute time quota'));
    const cooldown = createRuntimeDatabaseVerificationCooldown({
      classify: unavailable,
      cooldownMs: 5000,
      now: clock.now,
    });

    // One real failure is recorded first — exactly what DB.ts's module-load
    // warm-up does during a provider outage.
    await expect(cooldown.guard(attempt)).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(attempt).toHaveBeenCalledTimes(1);

    const outcomes = await Promise.all(
      Array.from({ length: 25 }, () => cooldown.guard(attempt).catch((error: unknown) => error)),
    );

    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    }

    // Not one extra dial-out: the cooldown, not in-flight sharing, is what
    // bounds a sustained outage.
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('healthy path stays fast: once succeeded, a later call still runs attempt again (no stale caching of success)', async () => {
    const clock = fakeClock();
    const attempt = vi.fn().mockResolvedValue(undefined);
    const cooldown = createRuntimeDatabaseVerificationCooldown({
      classify: unavailable,
      cooldownMs: 1000,
      now: clock.now,
    });

    await expect(cooldown.guard(attempt)).resolves.toBeUndefined();

    clock.advance(10_000);

    await expect(cooldown.guard(attempt)).resolves.toBeUndefined();
    await expect(cooldown.guard(attempt)).resolves.toBeUndefined();

    // Every call ran a real attempt — this cooldown only ever suppresses
    // RETRIES after a FAILURE; it never substitutes for or skips a live
    // per-connection attestation, sequentially or concurrently (see the
    // per-caller test above). In production `attempt` is cheap for an
    // already-healthy pool: pg-pool only re-runs `verify` for NEW physical
    // connections, not for every query.
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
