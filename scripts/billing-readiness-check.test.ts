import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BYPASS_HEADER,
  fetchHealthBilling,
  type HealthFetch,
  main,
  parseReadinessArguments,
} from './billing-readiness-check';

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('billing readiness CLI arguments', () => {
  it('defaults to dark-deploy evidence', () => {
    expect(parseReadinessArguments([])).toEqual({
      healthUrl: null,
      webhookEventTypesFile: null,
      bypassSecretEnv: null,
      mode: 'dark',
      error: null,
    });
  });

  it('requires an explicit activation mode so its verdict controls the exit code', () => {
    expect(parseReadinessArguments([
      '--mode',
      'activation',
      '--webhook-event-types-file',
      '/secure/endpoint-events.json',
    ])).toEqual({
      healthUrl: null,
      webhookEventTypesFile: '/secure/endpoint-events.json',
      bypassSecretEnv: null,
      mode: 'activation',
      error: null,
    });
  });

  it('accepts only an environment-variable name for a protected Preview health check', () => {
    expect(parseReadinessArguments([
      '--health-url',
      'https://preview.example/api/health',
      '--bypass-secret-env',
      'VERCEL_AUTOMATION_BYPASS_SECRET',
    ])).toMatchObject({ bypassSecretEnv: 'VERCEL_AUTOMATION_BYPASS_SECRET', error: null });
    expect(parseReadinessArguments(['--bypass-secret-env', 'SECRET_NAME']).error)
      .toBe('--bypass-secret-env is only meaningful with --health-url');
  });

  it('rejects an absent or unsupported readiness mode', () => {
    expect(parseReadinessArguments(['--mode']).error).toBe('--mode requires either "dark" or "activation"');
    expect(parseReadinessArguments(['--mode', 'anything']).error).toBe('--mode requires either "dark" or "activation"');
  });

  it('does not swallow a following flag as an event-file value', () => {
    expect(parseReadinessArguments([
      '--webhook-event-types-file',
      '--mode',
      'activation',
    ]).error).toBe('--webhook-event-types-file requires a value');
  });
});

describe('protected Preview health evidence', () => {
  it('uses the bypass value only as a header and refuses redirects', async () => {
    const seen: Parameters<HealthFetch>[] = [];
    const fetchImpl: HealthFetch = async (url, init) => {
      seen.push([url, init]);
      return { ok: true, status: 200, json: async () => ({ billing: { dark: true, planEnvMatchesRuntime: true }, schemaDrift: 'ready' }) };
    };

    await expect(fetchHealthBilling('https://preview.example/api/health', 'not-in-argv', fetchImpl))
      .resolves.toEqual({ dark: true, planEnvMatchesRuntime: true, schemaDrift: 'ready' });
    expect(seen).toEqual([['https://preview.example/api/health', {
      method: 'GET',
      headers: { [BYPASS_HEADER]: 'not-in-argv' },
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    }]]);
  });

  it('does not follow a redirect or print a transport-error sentinel', async () => {
    const writes: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const redirect: HealthFetch = async () => ({ ok: false, status: 302, json: async () => ({}) });

    await expect(fetchHealthBilling('https://preview.example/api/health', 'sentinel-secret', redirect)).resolves.toBeNull();

    stderr.mockRestore();

    expect(writes.join('')).not.toContain('sentinel-secret');
  });

  it.each(['transport', 'json'] as const)('does not expose %s error details', async (failure) => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const fetchImpl: HealthFetch = async () => {
      if (failure === 'transport') {
        throw new Error('sentinel-secret');
      }
      return { ok: true, status: 200, json: async () => {
        throw new Error('sentinel-secret');
      } };
    };

    await expect(fetchHealthBilling('https://preview.example/api/health', null, fetchImpl)).resolves.toBeNull();
    expect(writes.join('')).toContain('request failed');
    expect(writes.join('')).not.toContain('sentinel-secret');
  });

  it('prints only approved health fields', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const fetchImpl: HealthFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        billing: { dark: true, planEnvMatchesRuntime: true, extra: 'sentinel-secret' },
        schemaDrift: 'ready',
        extra: 'sentinel-secret',
      }),
    });
    await fetchHealthBilling('https://preview.example/api/health', null, fetchImpl);

    expect(writes.join('')).toContain('"schemaDrift":"ready"');
    expect(writes.join('')).not.toContain('sentinel-secret');
  });
});

describe('CLI health failure verdict', () => {
  it('prints both readiness verdicts false when requested health is unavailable', async () => {
    process.argv = ['node', 'billing-readiness-check.ts', '--health-url', 'https://preview.example/api/health'];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await main();

    expect(process.exitCode).toBe(4);
    expect(output.join('')).toContain('"readyForDarkDeploy": false');
    expect(output.join('')).toContain('"readyForActivation": false');
  });
});
