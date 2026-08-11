import 'server-only';

import {
  DEPOSIT_READINESS_MAX_AGE_MS,
  type ResolvedDepositPolicy,
  resolveDepositPolicy,
} from '@/libs/depositPolicy';
import { computeExpectedLivemode } from '@/libs/environmentIsolation';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

/**
 * The ONE derivation of the expected Stripe mode, evaluated ONCE at module
 * scope with the throw captured, and EXPORTED.
 *
 * The `export` is load-bearing. `resolveDepositPolicy`'s `expectedLivemode`
 * parameter is REQUIRED and the downstream booking PR is the resolver's
 * in-transaction caller; a module-private const would leave that implementer
 * with no obtainable source for a mandatory money-gate input, and a disagreeing
 * invented value fails the livemode conjunct, flattens to `policy_inactive`,
 * returns `{required:false}` — and the booking commits FREE while the confirm
 * page disclosed a deposit.
 *
 * One call site, at module scope: a per-call re-read of `process.env` would let
 * config drift produce two different answers inside one request, and two calls
 * in one request are real here (the confirm-page render and the booking PR's
 * in-transaction resolution).
 *
 * The `catch` is defence in depth — the producer documents itself as
 * never-throwing — and `null` is also the landing zone for its reachable
 * `MODE_INDETERMINATE` result. The log line is required, not optional: the
 * branch is unreachable in serving today, so if it ever fires the cause must be
 * one line away.
 */
export const EXPECTED_LIVEMODE: boolean | null = (() => {
  try {
    const result = computeExpectedLivemode(process.env);
    return result.ok ? result.livemode : null;
  } catch (error) {
    console.error('[deposits] the expected Stripe mode could not be derived', error);
    return null;
  }
})();

export type DepositPolicyForSalon = ResolvedDepositPolicy & {
  /** ADVISORY DISPLAY ONLY. Gates nothing and never enters the resolver. */
  readinessStale: boolean;
  /** ADVISORY DISPLAY ONLY. Gates nothing and never enters the resolver. */
  readinessAgeMs: number | null;
};

type SalonLike = {
  settings?: unknown;
  features?: unknown;
} | null | undefined;

/**
 * The only database-reading deposit function.
 *
 * RESOLVE LOCALLY FIRST — the ordering is the requirement, not an optimisation.
 * With `stripeAccount: null` every reason that precedes the binding conjuncts is
 * final without I/O, and `account_not_connected` comes back exactly when the
 * account is the one remaining question. Short-circuiting on only the two launch
 * gates would issue the binding read for every ENTITLED salon before the
 * salon-local conjuncts are evaluated, so a transient database fault on a salon
 * whose owner had stored `deposit.enabled: false` would resolve `undetermined`,
 * which the booking PR turns into `DEPOSITS_TEMPORARILY_UNAVAILABLE` on every
 * new public booking.
 *
 * It makes NO provider call on any path. This runs on every public confirm-page
 * render, so a readiness refresh would put an uncached Stripe read on an
 * unauthenticated public path, and the display helper must not gate anything.
 *
 * `@/libs/DB`, `@/libs/queries` and `@/libs/depositAccountSnapshot.server` are
 * reached ONLY through `await import(...)` — the repo's own idiom in
 * `bookingConfig.ts` and `bookingQuote.ts`. A static `import { db }` would force
 * `confirm/page.test.tsx` to mock THIS module, which would destroy the darkness
 * test.
 */
export async function getDepositPolicyForSalon(args: {
  salonId: string;
  salon?: SalonLike;
  collectionLive?: boolean;
  entitled?: boolean;
}): Promise<DepositPolicyForSalon> {
  try {
    let salon = args.salon ?? null;
    if (!salon) {
      const { getSalonById } = await import('@/libs/queries');
      salon = await getSalonById(args.salonId);
    }

    const baseArgs = {
      settings: (salon?.settings as SalonSettings | null | undefined) ?? null,
      features: (salon?.features as SalonFeatures | null | undefined) ?? null,
      expectedLivemode: EXPECTED_LIVEMODE,
      collectionLive: args.collectionLive,
      entitled: args.entitled,
    };

    const local = resolveDepositPolicy({ ...baseArgs, stripeAccount: null });
    if (!local.active && local.reason !== 'account_not_connected') {
      return { ...local, readinessStale: false, readinessAgeMs: null };
    }

    const { readDepositAccountSnapshot } = await import('@/libs/depositAccountSnapshot.server');
    const snapshot = await readDepositAccountSnapshot(args.salonId);
    const resolved = resolveDepositPolicy({ ...baseArgs, stripeAccount: snapshot });

    const lastSyncedAt = snapshot?.lastSyncedAt ?? null;
    const readinessAgeMs = lastSyncedAt === null
      ? null
      : Math.max(0, Date.now() - lastSyncedAt.getTime());
    const readinessStale = readinessAgeMs === null
      || readinessAgeMs > DEPOSIT_READINESS_MAX_AGE_MS;

    return { ...resolved, readinessStale, readinessAgeMs };
  } catch (error) {
    console.error('[deposits] policy could not be resolved', error);
    return {
      active: false,
      reason: 'undetermined',
      amountCents: null,
      readinessStale: false,
      readinessAgeMs: null,
    };
  }
}
