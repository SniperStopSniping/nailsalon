import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

vi.mock('server-only', () => ({}));

const { readDepositAccountSnapshot, getSalonById, dbHandle } = vi.hoisted(() => ({
  readDepositAccountSnapshot: vi.fn(),
  getSalonById: vi.fn(),
  dbHandle: { select: vi.fn(), update: vi.fn(), transaction: vi.fn() },
}));

vi.mock('@/libs/depositAccountSnapshot.server', () => ({ readDepositAccountSnapshot }));
vi.mock('@/libs/queries', () => ({ getSalonById }));
vi.mock('@/libs/DB', () => ({ db: dbHandle }));

const SERVER_SOURCE = readFileSync(
  path.join(process.cwd(), 'src/libs/depositPolicy.server.ts'),
  'utf8',
);

const ENTITLED: SalonFeatures = { money: { deposits: true } };

function salon(deposit: unknown, extra: Record<string, unknown> = {}) {
  return {
    settings: { payments: { deposit }, ...extra } as unknown as SalonSettings,
    features: ENTITLED,
  };
}

function chargeReadySnapshot() {
  return {
    chargesEnabled: true,
    revokedAt: null,
    lastSyncedAt: new Date(),
    // NOT a typo: under Vitest `resolveRuntimeEnvironment` returns 'test', so
    // the expected mode is FALSE. A `true` fixture would never resolve active.
    livemode: false,
  };
}

async function loadModule() {
  return import('@/libs/depositPolicy.server');
}

beforeEach(() => {
  vi.clearAllMocks();
  readDepositAccountSnapshot.mockResolvedValue(chargeReadySnapshot());
});

// =============================================================================
// 10 / 11 — the two launch gates cost nothing
// =============================================================================

describe('test 10 — collection not live', () => {
  it('never touches the database handle', async () => {
    const { getDepositPolicyForSalon } = await loadModule();
    const result = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: salon({ enabled: true, amountCents: 2500 }),
      collectionLive: false,
      entitled: true,
    });

    expect(result).toMatchObject({ active: false, reason: 'collection_not_live' });
    expect(readDepositAccountSnapshot).not.toHaveBeenCalled();
    expect(dbHandle.select).not.toHaveBeenCalled();
  });
});

describe('test 11 — not entitled', () => {
  it('never touches the database handle', async () => {
    const { getDepositPolicyForSalon } = await loadModule();
    const result = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: { settings: salon({ enabled: true, amountCents: 2500 }).settings, features: null },
      collectionLive: true,
    });

    expect(result).toMatchObject({ active: false, reason: 'not_entitled' });
    expect(readDepositAccountSnapshot).not.toHaveBeenCalled();
    expect(dbHandle.select).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 12 / 12b / 12c — failure containment and LOCAL-FIRST ordering
// =============================================================================

describe('test 12 — a throwing binding read is undetermined, not a throw', () => {
  it('returns the typed reason', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    readDepositAccountSnapshot.mockRejectedValue(new Error('database down'));

    const { getDepositPolicyForSalon } = await loadModule();
    const result = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: salon({ enabled: true, amountCents: 2500 }),
      collectionLive: true,
      entitled: true,
    });

    expect(result).toMatchObject({ active: false, reason: 'undetermined', amountCents: null });

    consoleError.mockRestore();
  });
});

describe('test 12b — LOCAL-FIRST: a salon-local answer issues NO query', () => {
  const cases: Array<[string, unknown, Record<string, unknown>, string]> = [
    ['(i) deposits switched off', { enabled: false, amountCents: 2500 }, {}, 'disabled'],
    ['(ii) an out-of-ceiling amount', { enabled: true, amountCents: 5_000_000 }, {}, 'not_configured'],
    ['(iii) an unsupported stored currency', { enabled: true, amountCents: 2500 }, { booking: { currency: 'USD' } }, 'currency_unsupported'],
  ];

  it.each(cases)('%s resolves without the binding read', async (_label, deposit, extra, reason) => {
    const { getDepositPolicyForSalon } = await loadModule();
    const result = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: salon(deposit, extra),
      collectionLive: true,
      entitled: true,
    });

    expect(result).toMatchObject({ active: false, reason });
    // THE negative assertion that makes this test about ordering. Short-circuiting
    // on only the two launch gates would issue the read for every entitled salon,
    // so a transient database fault on a salon whose owner had switched deposits
    // OFF would resolve `undetermined` — a hard refusal on every new booking.
    expect(readDepositAccountSnapshot).not.toHaveBeenCalled();
  });
});

describe('test 12c — the complement', () => {
  it('issues the read when the stored settings do not answer', async () => {
    const { getDepositPolicyForSalon } = await loadModule();
    const result = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: salon({ enabled: true, amountCents: 2500 }),
      collectionLive: true,
      entitled: true,
    });

    expect(readDepositAccountSnapshot).toHaveBeenCalledTimes(1);
    expect(readDepositAccountSnapshot).toHaveBeenCalledWith('salon_1');
    expect(result.active).toBe(true);
  });
});

// =============================================================================
// 13 / 13b / 13c — zero provider calls, and the expected-mode provenance
// =============================================================================

describe('test 13 — zero provider calls on the read path', () => {
  it('names neither readiness entry point and touches no Stripe client', () => {
    expect(SERVER_SOURCE).not.toContain('refreshAccountReadiness');
    expect(SERVER_SOURCE).not.toContain('getAccountReadinessForDisplay');
    expect(SERVER_SOURCE).not.toContain('@/libs/stripe');
    expect(SERVER_SOURCE).not.toMatch(/STRIPE_SECRET_KEY|sk_live_/);
  });

  it('reaches the database only through dynamic imports', () => {
    expect(SERVER_SOURCE).not.toMatch(/^\s*import\s+\{[^}]*\}\s+from\s+'@\/libs\/DB'/m);
    expect(SERVER_SOURCE).toContain('await import(\'@/libs/queries\')');
    expect(SERVER_SOURCE).toContain('await import(\'@/libs/depositAccountSnapshot.server\')');
  });
});

describe('test 13b — EXPECTED_LIVEMODE provenance', () => {
  it('has exactly one producer call site, at module scope', () => {
    const producerCalls = SERVER_SOURCE.match(/computeExpectedLivemode\s*\(/g) ?? [];

    expect(producerCalls.length).toBe(1);
    // At module scope, i.e. in the exported IIFE — not inside a function body.
    expect(SERVER_SOURCE).toMatch(
      /export const EXPECTED_LIVEMODE: boolean \| null = \(\(\) => \{/,
    );
  });

  it('is EXPORTED and passed through exactly once', () => {
    // The export is load-bearing: the resolver's `expectedLivemode` parameter is
    // REQUIRED and the downstream booking PR is its in-transaction caller. A
    // module-private const leaves that implementer inventing one, and a
    // disagreeing value books FREE while the confirm page disclosed a deposit.
    expect(SERVER_SOURCE).toContain('export const EXPECTED_LIVEMODE');
    expect(SERVER_SOURCE.match(/EXPECTED_LIVEMODE/g)?.length ?? 0).toBe(2);
    expect(SERVER_SOURCE).toContain('expectedLivemode: EXPECTED_LIVEMODE');
  });

  it('keeps a NON-SILENT catch, inside the IIFE itself', () => {
    // Scoped to the derivation: the policy reader further down has its own
    // logging catch, and a file-wide regex would match that one instead.
    const iife = SERVER_SOURCE
      .split('export const EXPECTED_LIVEMODE: boolean | null = (() => {')[1]!
      .split('})();')[0]!;

    expect(iife).toMatch(/catch\s*\(error\)\s*\{/);
    expect(iife).toContain('console.error(');
  });

  it('resolves undetermined when the producer is indeterminate', async () => {
    vi.resetModules();
    vi.doMock('@/libs/environmentIsolation', () => ({
      computeExpectedLivemode: () => ({ ok: false, code: 'MODE_INDETERMINATE' }),
    }));

    const reloaded = await import('@/libs/depositPolicy.server');

    expect(reloaded.EXPECTED_LIVEMODE).toBeNull();

    const result = await reloaded.getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: salon({ enabled: true, amountCents: 2500 }),
      collectionLive: true,
      entitled: true,
    });

    expect(result).toMatchObject({ active: false, reason: 'undetermined' });

    vi.doUnmock('@/libs/environmentIsolation');
    vi.resetModules();
  });
});

describe('test 13c — agreement with the producer', () => {
  it('resolves undetermined exactly when the producer returns ok:false', async () => {
    vi.resetModules();
    vi.doMock('@/libs/environmentIsolation', () => ({
      computeExpectedLivemode: () => ({ ok: true, livemode: false }),
    }));

    const okModule = await import('@/libs/depositPolicy.server');

    expect(okModule.EXPECTED_LIVEMODE).toBe(false);
    expect((await okModule.getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: salon({ enabled: true, amountCents: 2500 }),
      collectionLive: true,
      entitled: true,
    })).active).toBe(true);

    vi.doUnmock('@/libs/environmentIsolation');
    vi.resetModules();
  });
});

// =============================================================================
// readinessStale / readinessAgeMs are advisory and gate nothing
// =============================================================================

describe('advisory readiness fields', () => {
  it('reports a stale age without disabling the policy', async () => {
    readDepositAccountSnapshot.mockResolvedValue({
      ...chargeReadySnapshot(),
      lastSyncedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });

    const { getDepositPolicyForSalon } = await loadModule();
    const result = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: salon({ enabled: true, amountCents: 2500 }),
      collectionLive: true,
      entitled: true,
    });

    expect(result.active).toBe(true);
    expect(result.readinessStale).toBe(true);
    expect(result.readinessAgeMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it('never lets the advisory constant reach the resolver', () => {
    const policySource = readFileSync(
      path.join(process.cwd(), 'src/libs/depositPolicy.ts'),
      'utf8',
    );
    const resolver = policySource
      .split('export function resolveDepositPolicy(')[1]!
      .split('\n// ====')[0]!;

    expect(resolver).not.toContain('DEPOSIT_READINESS_MAX_AGE_MS');
  });
});

// =============================================================================
// the salon fallback
// =============================================================================

describe('the optional pre-loaded salon', () => {
  it('loads the salon itself when none is supplied', async () => {
    getSalonById.mockResolvedValue({
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
      features: ENTITLED,
    });

    const { getDepositPolicyForSalon } = await loadModule();
    const result = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      collectionLive: true,
      entitled: true,
    });

    expect(getSalonById).toHaveBeenCalledWith('salon_1');
    expect(result.active).toBe(true);
  });
});
