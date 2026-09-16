/**
 * Per-target readiness CLI proofs — RD-4/RD-5/RD-7 (handoff §5.3 item 4),
 * plus the #225 transport hardening this PR must not weaken: HTTPS-only
 * evidence URLs, redirects refused (an automation-bypass header is never
 * replayed to a redirect target), a bounded deadline, strict endpoint-object
 * validation, and an exit-code latch that only ever ratchets upward.
 *
 * `sentinel-secret` below stands in for any secret VALUE: every assertion
 * that names it is asserting the CLI did NOT print it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BYPASS_HEADER,
  DEVELOPER_BANNER,
  EXIT_EVIDENCE_MISSING,
  EXIT_SOURCE_INSUFFICIENT,
  EXIT_TARGET_MET,
  EXIT_TARGET_NOT_MET,
  ExitLatch,
  fetchDeployedHealth,
  fetchDeployedReadiness,
  type HealthFetch,
  main,
  parseReadinessArguments,
  parseVercelCrons,
  readEnvFileNamesAndCarrier,
  validateCronProof,
  validateHealthFacts,
  validateIntegrityReport,
  validatePortalConfigurations,
  validateReadinessFacts,
  validateWebhookEndpoint,
} from './billing-readiness-check';

const originalArgv = process.argv;
const temporaryDirectories: string[] = [];

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-readiness-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeFixture(name: string, contents: unknown): string {
  const file = path.join(fixtureDirectory(), name);
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return file;
}

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  return {
    get out() {
      return stdout.join('');
    },
    get err() {
      return stderr.join('');
    },
  };
}

describe('exit-code latch', () => {
  it('ratchets upward and never back down', () => {
    const latch = new ExitLatch();

    expect(latch.value).toBe(EXIT_TARGET_MET);

    latch.raise(EXIT_TARGET_NOT_MET);
    latch.raise(EXIT_TARGET_MET);

    expect(latch.value).toBe(EXIT_TARGET_NOT_MET);

    latch.raise(EXIT_SOURCE_INSUFFICIENT);
    latch.raise(EXIT_EVIDENCE_MISSING);
    latch.raise(EXIT_TARGET_MET);

    expect(latch.value).toBe(EXIT_SOURCE_INSUFFICIENT);
  });
});

describe('CLI arguments', () => {
  it('requires an explicit target and an explicit evidence source', () => {
    expect(parseReadinessArguments([]).error).toContain('--target is required');
    expect(parseReadinessArguments(['--target', 'dark']).error).toContain('--env-source is required');
    expect(parseReadinessArguments(['--target', 'anything', '--env-source', 'deployed']).error)
      .toContain('--target must be one of');
    expect(parseReadinessArguments(['--target', 'dark', '--env-source', 'guesswork']).error)
      .toContain('--env-source must be one of');
  });

  it('accepts each of the four targets', () => {
    for (const target of ['dark', 'rehearsal', 'activate-topups', 'activate-subscriptions']) {
      expect(parseReadinessArguments([
        '--target',
        target,
        '--env-source',
        'env-file',
      ])).toMatchObject({ target, envSource: 'env-file', error: null });
    }
  });

  it('refuses the removed --mode flag with a migration message', () => {
    expect(parseReadinessArguments(['--mode', 'activation', '--target', 'dark', '--env-source', 'deployed']).error)
      .toContain('--mode was replaced by --target');
  });

  it('refuses --env-source local without --developer, and never lets it exit 0', () => {
    const refused = parseReadinessArguments(['--target', 'dark', '--env-source', 'local']);

    expect(refused.error).toContain('--developer');
    expect(refused.errorExit).toBe(EXIT_SOURCE_INSUFFICIENT);
    expect(parseReadinessArguments(['--target', 'dark', '--env-source', 'local', '--developer']))
      .toMatchObject({ envSource: 'local', developer: true, error: null });
  });

  it('does not swallow a following flag as a value', () => {
    expect(parseReadinessArguments([
      '--target',
      'rehearsal',
      '--env-source',
      'deployed',
      '--webhook-endpoint-file',
      '--portal-config-file',
      '/secure/portal.json',
    ]).error).toBe('--webhook-endpoint-file requires a value');
  });

  it('accepts only an environment-variable NAME for the bypass and cron secrets', () => {
    const parsed = parseReadinessArguments([
      '--target',
      'rehearsal',
      '--env-source',
      'deployed',
      '--health-url',
      'https://preview.example/api/health',
      '--bypass-secret-env',
      'VERCEL_AUTOMATION_BYPASS_SECRET',
      '--cron-secret-env',
      'PREVIEW_CRON_SECRET',
    ]);

    expect(parsed).toMatchObject({
      bypassSecretEnv: 'VERCEL_AUTOMATION_BYPASS_SECRET',
      cronSecretEnv: 'PREVIEW_CRON_SECRET',
      error: null,
    });
    expect(parseReadinessArguments(['--target', 'dark', '--env-source', 'env-file', '--bypass-secret-env', 'NAME']).error)
      .toContain('only meaningful with --health-url');
  });

  it('requires --environment alongside a pulled env file', () => {
    expect(parseReadinessArguments(['--target', 'dark', '--env-source', 'env-file', '--env-file', '/secure/x.env']).error)
      .toContain('--environment preview|production');
    expect(parseReadinessArguments([
      '--target',
      'dark',
      '--env-source',
      'env-file',
      '--env-file',
      '/secure/x.env',
      '--environment',
      'staging',
    ]).error).toContain('--environment must be one of');
  });

  it('refuses saved evidence files when the declared source is the live deployment', () => {
    expect(parseReadinessArguments([
      '--target',
      'dark',
      '--env-source',
      'deployed',
      '--health-url',
      'https://preview.example/api/health',
      '--readiness-file',
      '/secure/readiness.json',
    ]).error).toContain('refused with --env-source deployed');
  });

  it('requires a health URL when the declared source is the live deployment', () => {
    expect(parseReadinessArguments(['--target', 'dark', '--env-source', 'deployed']).error)
      .toContain('--env-source deployed requires --health-url');
  });
});

describe('deployed health evidence', () => {
  const okBody = {
    status: 'ok',
    schemaDrift: 'ready',
    gitSha: 'abc1234',
    billing: { dark: true, planEnvMatchesRuntime: true },
  };

  it('sends the bypass value only as a header, bounded, without following redirects', async () => {
    const seen: Parameters<HealthFetch>[] = [];
    const fetchImpl: HealthFetch = async (url, init) => {
      seen.push([url, init]);
      return { ok: true, status: 200, json: async () => okBody };
    };

    await expect(fetchDeployedHealth(
      'https://preview.example/api/health',
      { bypassSecret: 'not-in-argv', acceptDegraded: false },
      fetchImpl,
    )).resolves.toMatchObject({ ok: true });
    expect(seen).toEqual([['https://preview.example/api/health', {
      method: 'GET',
      headers: { [BYPASS_HEADER]: 'not-in-argv' },
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    }]]);
  });

  it('refuses a non-HTTPS URL and a URL carrying credentials or a query', async () => {
    for (const url of [
      'http://preview.example/api/health',
      'https://user:pass@preview.example/api/health',
      'https://preview.example/api/health?x-vercel-protection-bypass=sentinel-secret',
    ]) {
      const result = await fetchDeployedHealth(url, { bypassSecret: null, acceptDegraded: false }, async () => {
        throw new Error('must not be fetched');
      });

      expect(result).toEqual({ ok: false, reason: expect.stringContaining('HTTPS') });
    }
  });

  it('refuses a redirect rather than replaying the bypass header to its target', async () => {
    const redirect: HealthFetch = async () => ({ ok: false, status: 302, json: async () => ({}) });
    const result = await fetchDeployedHealth(
      'https://preview.example/api/health',
      { bypassSecret: 'sentinel-secret', acceptDegraded: true },
      redirect,
    );

    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain('sentinel-secret');
  });

  it.each(['transport', 'json'] as const)('does not expose %s error details', async (failure) => {
    const fetchImpl: HealthFetch = async () => {
      if (failure === 'transport') {
        throw new Error('sentinel-secret');
      }
      return { ok: true, status: 200, json: async () => {
        throw new Error('sentinel-secret');
      } };
    };

    const result = await fetchDeployedHealth('https://preview.example/api/health', { bypassSecret: null, acceptDegraded: false }, fetchImpl);

    expect(result).toEqual({ ok: false, reason: 'health request failed' });
  });

  it('RD-7: reads the billing block out of a 503 body ONLY for a Preview target', async () => {
    const degraded: HealthFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ ...okBody, status: 'degraded', billing: { dark: false, planEnvMatchesRuntime: true } }),
    });

    await expect(fetchDeployedHealth('https://preview.example/api/health', { bypassSecret: null, acceptDegraded: true }, degraded))
      .resolves.toEqual({
        ok: true,
        value: {
          httpStatus: 503,
          status: 'degraded',
          dark: false,
          planEnvMatchesRuntime: true,
          schemaDrift: 'ready',
          gitSha: 'abc1234',
        },
      });
    await expect(fetchDeployedHealth('https://www.lustergel.app/api/health', { bypassSecret: null, acceptDegraded: false }, degraded))
      .resolves.toEqual({ ok: false, reason: 'health URL returned HTTP 503' });
  });

  it('rejects a body with no well-formed billing block', () => {
    expect(validateHealthFacts({ status: 'ok', schemaDrift: 'ready' }, 200)).toMatchObject({ ok: false });
    expect(validateHealthFacts({ status: 'ok', schemaDrift: 'ready', billing: { dark: 'yes' } }, 200)).toMatchObject({ ok: false });
    expect(validateHealthFacts([], 200)).toMatchObject({ ok: false });
  });
});

describe('deployed readiness endpoint evidence', () => {
  const body = {
    planEnv: 'test',
    planEnvMatchesRuntime: true,
    vercelEnv: 'preview',
    gitSha: 'abc1234',
    appOrigin: 'https://preview.example',
    switches: { subscriptions: true, topups: true, publicPricing: false, taxCollection: false },
    webhookSecretConfigured: true,
    webhookSecretDistinct: true,
    stripeKeyMode: 'test',
    cronSecretConfigured: true,
    identityHmacConfigured: true,
    identityHmacVersion: 1,
    carrier: { present: true, env: 'test', offers: 6, topups: 7, coupons: 1, digest: 'a'.repeat(64), parse: 'ok' },
    deploymentMarker: true,
    timestamp: '2026-09-16T00:00:00.000Z',
  };

  it('authorizes with a Bearer header and never puts the secret in the URL', async () => {
    const seen: Parameters<HealthFetch>[] = [];
    const fetchImpl: HealthFetch = async (url, init) => {
      seen.push([url, init]);
      return { ok: true, status: 200, json: async () => body };
    };

    await expect(fetchDeployedReadiness(
      'https://preview.example/api/billing/readiness',
      { bypassSecret: 'bypass-value', cronSecret: 'sentinel-secret' },
      fetchImpl,
    )).resolves.toMatchObject({ ok: true });
    expect(seen[0]![0]).toBe('https://preview.example/api/billing/readiness');
    expect(seen[0]![1].headers).toEqual({
      authorization: 'Bearer sentinel-secret',
      [BYPASS_HEADER]: 'bypass-value',
    });
  });

  it('treats an absent CRON_SECRET, a 401, and a redirect as unusable evidence', async () => {
    const unauthorized: HealthFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const redirect: HealthFetch = async () => ({ ok: false, status: 307, json: async () => ({}) });

    await expect(fetchDeployedReadiness('https://preview.example/api/billing/readiness', { bypassSecret: null, cronSecret: null }))
      .resolves.toEqual({ ok: false, reason: expect.stringContaining('no CRON_SECRET available') });
    await expect(fetchDeployedReadiness('https://preview.example/api/billing/readiness', { bypassSecret: null, cronSecret: 'x' }, unauthorized))
      .resolves.toEqual({ ok: false, reason: expect.stringContaining('401') });
    await expect(fetchDeployedReadiness('https://preview.example/api/billing/readiness', { bypassSecret: null, cronSecret: 'x' }, redirect))
      .resolves.toEqual({ ok: false, reason: expect.stringContaining('redirected') });
  });

  it('rejects a body missing any required presence fact', () => {
    expect(validateReadinessFacts(body)).toMatchObject({ ok: true });
    expect(validateReadinessFacts({ ...body, switches: { subscriptions: true } })).toMatchObject({ ok: false });
    expect(validateReadinessFacts({ ...body, carrier: undefined })).toMatchObject({ ok: false });
    expect(validateReadinessFacts({ ...body, cronSecretConfigured: 'yes' })).toMatchObject({ ok: false });
    expect(validateReadinessFacts([])).toMatchObject({ ok: false });
  });
});

describe('RD-4 — evidence-file validation', () => {
  const endpoint = {
    id: 'we_12345678',
    url: 'https://preview.example/api/webhooks/stripe-billing',
    livemode: false,
    status: 'enabled',
    enabled_events: ['checkout.session.completed'],
  };

  it('rejects a bare array where an endpoint OBJECT export is required', () => {
    expect(validateWebhookEndpoint([endpoint])).toMatchObject({ ok: false });
    expect(validateWebhookEndpoint(endpoint)).toMatchObject({ ok: true });
  });

  it.each([
    ['id', { ...endpoint, id: 12345678 }],
    ['url', { ...endpoint, url: null }],
    ['livemode', { ...endpoint, livemode: 'false' }],
    ['status', { ...endpoint, status: undefined }],
    ['enabled_events', { ...endpoint, enabled_events: 'checkout.session.completed' }],
    ['enabled_events entries', { ...endpoint, enabled_events: [1, 2] }],
  ])('rejects an endpoint export with a bad %s', (_label, value) => {
    expect(validateWebhookEndpoint(value)).toMatchObject({ ok: false });
  });

  it('accepts both portal export shapes and rejects a malformed entry', () => {
    const configuration = { id: 'bpc_1', is_default: true, features: { subscription_update: { enabled: false } } };

    expect(validatePortalConfigurations([configuration])).toMatchObject({ ok: true });
    expect(validatePortalConfigurations({ data: [configuration] })).toMatchObject({ ok: true });
    expect(validatePortalConfigurations({ data: [{ id: 'bpc_1' }] })).toMatchObject({ ok: false });
    expect(validatePortalConfigurations('nope')).toMatchObject({ ok: false });
  });

  it('validates the cron proof and the integrity report', () => {
    expect(validateCronProof({ recordedAt: 'now', invocations: [{ path: '/api/billing/reconcile', status: 200 }] })).toMatchObject({ ok: true });
    expect(validateCronProof({ invocations: [] })).toMatchObject({ ok: false });
    expect(validateCronProof({ recordedAt: 'now', invocations: [{ path: '/api/billing/reconcile' }] })).toMatchObject({ ok: false });
    expect(validateIntegrityReport({ exitCode: 0, violations: [] })).toMatchObject({ ok: true });
    expect(validateIntegrityReport({ exitCode: '0', violations: [] })).toMatchObject({ ok: false });
  });

  it('parses vercel.json crons and rejects a malformed list', () => {
    expect(parseVercelCrons('{"crons":[{"path":"/api/billing/reconcile","schedule":"17 * * * *"}]}')).toMatchObject({ ok: true });
    expect(parseVercelCrons('{}')).toEqual({ ok: true, value: [] });
    expect(parseVercelCrons('{"crons":["/api/billing/reconcile"]}')).toMatchObject({ ok: false });
    expect(parseVercelCrons('not json')).toMatchObject({ ok: false });
  });
});

describe('pulled env file reading', () => {
  it('returns variable NAMES and the carrier only — never any other value', () => {
    const result = readEnvFileNamesAndCarrier([
      '# pulled for the preview branch scope',
      'BILLING_PLAN_ENV="test"',
      'STRIPE_BILLING_WEBHOOK_SECRET="sentinel-secret"',
      'export CRON_SECRET=\'sentinel-secret\'',
      'BILLING_STRIPE_PRICE_IDS="{\\"env\\":\\"test\\",\\"offers\\":{},\\"topups\\":{},\\"coupons\\":{}}"',
      'not a variable line',
      '',
    ].join('\n'));

    expect(result.names).toEqual([
      'BILLING_PLAN_ENV',
      'STRIPE_BILLING_WEBHOOK_SECRET',
      'CRON_SECRET',
      'BILLING_STRIPE_PRICE_IDS',
    ]);
    expect(result.planEnv).toBe('test');
    expect(result.carrierRaw).toBe('{"env":"test","offers":{},"topups":{},"coupons":{}}');
    expect(JSON.stringify(result)).not.toContain('sentinel-secret');
  });
});

describe('RD-5 — the first output line names the evidence source', () => {
  it('a developer run announces the local source, prints the banner, and never exits 0', async () => {
    process.argv = ['node', 'billing-readiness-check.ts', '--target', 'dark', '--env-source', 'local', '--developer'];

    const output = captureOutput();

    await main();

    const lines = output.out.split('\n');

    expect(lines[0]).toBe('evidenceSource: local environment=unspecified origin=none');
    expect(lines[1]).toBe(DEVELOPER_BANNER);
    expect(process.exitCode).toBe(EXIT_SOURCE_INSUFFICIENT);
    expect(output.out).toContain('"evidenceSource": "local"');
    expect(output.out).toContain('"target": "dark"');
  });

  it('an env-file run announces the env-file source and its declared environment', async () => {
    const healthFile = writeFixture('health.json', {
      status: 'ok',
      schemaDrift: 'ready',
      gitSha: 'abc1234',
      billing: { dark: true, planEnvMatchesRuntime: true },
    });
    process.argv = [
      'node',
      'billing-readiness-check.ts',
      '--target',
      'dark',
      '--env-source',
      'env-file',
      '--environment',
      'production',
      '--health-file',
      healthFile,
    ];

    const output = captureOutput();

    await main();

    expect(output.out.split('\n')[0]).toBe('evidenceSource: env-file environment=production origin=none');
    expect(output.out).toContain(`file:${healthFile}`);
    expect(process.exitCode).toBe(EXIT_TARGET_MET);
  });
});

describe('CLI exit codes', () => {
  it('RD-4 + latch: an unreadable endpoint export raises 5, and an insufficient source then raises 6', async () => {
    const unreadable = writeFixture('endpoint.json', '{ this is not json');
    process.argv = [
      'node',
      'billing-readiness-check.ts',
      '--target',
      'rehearsal',
      '--env-source',
      'env-file',
      '--environment',
      'preview',
      '--webhook-endpoint-file',
      unreadable,
    ];

    const output = captureOutput();

    await main();

    expect(process.exitCode).toBe(EXIT_SOURCE_INSUFFICIENT);
    expect(output.err).toContain('--webhook-endpoint-file');
  });

  it('RD-4: an unreadable endpoint export is exit 5, never a verdict', async () => {
    const healthFile = writeFixture('health.json', {
      status: 'ok',
      schemaDrift: 'ready',
      billing: { dark: true, planEnvMatchesRuntime: true },
    });
    const unreadable = writeFixture('endpoint.json', '[]');
    process.argv = [
      'node',
      'billing-readiness-check.ts',
      '--target',
      'dark',
      '--env-source',
      'env-file',
      '--environment',
      'production',
      '--health-file',
      healthFile,
      '--webhook-endpoint-file',
      unreadable,
    ];

    captureOutput();

    await main();

    expect(process.exitCode).toBe(EXIT_EVIDENCE_MISSING);
  });

  it('exit 6: an env-file source can never prove a rehearsal target, however complete', async () => {
    const readinessFile = writeFixture('readiness.json', {
      planEnv: 'test',
      planEnvMatchesRuntime: true,
      vercelEnv: 'preview',
      gitSha: 'abc1234',
      appOrigin: 'https://preview.example',
      switches: { subscriptions: true, topups: true, publicPricing: false, taxCollection: false },
      webhookSecretConfigured: true,
      webhookSecretDistinct: true,
      stripeKeyMode: 'test',
      cronSecretConfigured: true,
      identityHmacConfigured: true,
      identityHmacVersion: 1,
      carrier: { present: true, env: 'test', offers: 6, topups: 7, coupons: 1, digest: 'a'.repeat(64), parse: 'ok' },
      deploymentMarker: true,
      timestamp: '2026-09-16T00:00:00.000Z',
    });
    process.argv = [
      'node',
      'billing-readiness-check.ts',
      '--target',
      'rehearsal',
      '--env-source',
      'env-file',
      '--environment',
      'preview',
      '--readiness-file',
      readinessFile,
    ];

    const output = captureOutput();

    await main();

    expect(process.exitCode).toBe(EXIT_SOURCE_INSUFFICIENT);
    expect(output.out).toContain('[FAIL] evidence_source');
  });

  it('exit 4: readable evidence that says the target is not met', async () => {
    const healthFile = writeFixture('health.json', {
      status: 'ok',
      schemaDrift: 'ready',
      billing: { dark: false, planEnvMatchesRuntime: true },
    });
    process.argv = [
      'node',
      'billing-readiness-check.ts',
      '--target',
      'dark',
      '--env-source',
      'env-file',
      '--environment',
      'production',
      '--health-file',
      healthFile,
    ];

    const output = captureOutput();

    await main();

    expect(process.exitCode).toBe(EXIT_TARGET_NOT_MET);
    expect(output.out).toContain('[FAIL] health_billing_dark');
    expect(output.out).toContain('met: false');
  });

  it('exit 5: a requested live health URL that cannot be read is never a pass', async () => {
    process.argv = [
      'node',
      'billing-readiness-check.ts',
      '--target',
      'dark',
      '--env-source',
      'deployed',
      '--health-url',
      'https://preview.example/api/health',
      '--environment',
      'production',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));

    const output = captureOutput();

    await main();

    expect(process.exitCode).toBe(EXIT_EVIDENCE_MISSING);
    expect(output.out).toContain('missingEvidence');
  });
});
