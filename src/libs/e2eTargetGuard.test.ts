import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertAllowedE2ETarget } from './e2eTargetGuard';

describe('E2E target guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    undefined,
    '',
    'http://localhost:3101',
    'https://luster-preview.example.com',
    'https://preview.islanailsalon.com',
  ])('allows a non-Production target: %s', (baseUrl) => {
    expect(() => assertAllowedE2ETarget(baseUrl, undefined, undefined)).not.toThrow();
  });

  it.each([
    'https://islanailsalon.com',
    'https://www.islanailsalon.com/path',
    'https://ISLANAILSALON.COM./book',
  ])('rejects the Production host at config load: %s', (baseUrl) => {
    expect(() => assertAllowedE2ETarget(baseUrl, undefined, undefined)).toThrow(
      'Production E2E target rejected',
    );
  });

  it('blocks an exact configured hostname and reports only its normalized hostname', () => {
    const password = ['never', 'print', 'password'].join('-');
    const querySecret = ['never', 'print', 'query'].join('-');
    const target
      = `https://synthetic:${password}@LUSTER-PRODUCTION-ALIAS.EXAMPLE.TEST/private?token=${querySecret}#fragment`;

    let message = '';
    try {
      assertAllowedE2ETarget(
        target,
        undefined,
        '  Luster-Production-Alias.Example.Test  ',
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('hostname "luster-production-alias.example.test" is blocked');
    expect(message).not.toContain(target);
    expect(message).not.toContain(password);
    expect(message).not.toContain(querySecret);
    expect(message).not.toContain('/private');
    expect(message).not.toContain('fragment');
  });

  it.each([
    'luster-preview-alias.vercel.app',
    'other-luster-production-alias.vercel.app',
    'preview.luster-production-alias.vercel.app',
    'luster-production-alias.vercel.app.example.test',
  ])('does not broaden an exact configured match to %s', (hostname) => {
    expect(() => assertAllowedE2ETarget(
      `https://${hostname}`,
      undefined,
      'luster-production-alias.vercel.app',
    )).not.toThrow();
  });

  it('normalizes case and surrounding whitespace in configured entries', () => {
    expect(() => assertAllowedE2ETarget(
      'https://LUSTER-PRODUCTION-ALIAS.VERCEL.APP./book',
      undefined,
      ' preview-production-alias.example.test, Luster-Production-Alias.Vercel.App ',
    )).toThrow('hostname "luster-production-alias.vercel.app" is blocked');
  });

  it.each([
    '',
    '   ',
    ',',
    ',prod.example.test',
    'prod.example.test,',
    'prod.example.test,,other.example.test',
    '*.vercel.app',
    'https://prod.example.test',
    'prod.example.test:443',
    'prod.example.test/path',
    'prod_example.test',
    'prod..example.test',
    '-prod.example.test',
    'prod-.example.test',
    'prød.example.test',
  ])('fails safely for a malformed configured blocklist: %j', (configuredHosts) => {
    expect(() => assertAllowedE2ETarget(
      'https://preview.example.test',
      '1',
      configuredHosts,
    )).toThrow(
      'LUSTER_E2E_BLOCKED_HOSTS must be a comma-separated list of exact hostnames.',
    );
  });

  it('preserves built-in behavior when the configured variable is missing', () => {
    expect(() => assertAllowedE2ETarget(
      'https://islanailsalon.com',
      undefined,
      undefined,
    )).toThrow('Production E2E target rejected');
    expect(() => assertAllowedE2ETarget(
      'https://luster-preview-alias.vercel.app',
      undefined,
      undefined,
    )).not.toThrow();
  });

  it.each([
    ['https://islanailsalon.com', undefined],
    ['https://luster-production-alias.vercel.app', 'luster-production-alias.vercel.app'],
  ])('bypasses both blocklists only with exact owner authorization', (target, configuredHosts) => {
    expect(() => assertAllowedE2ETarget(target, '1', configuredHosts)).not.toThrow();
    expect(() => assertAllowedE2ETarget(target, 'true', configuredHosts)).toThrow(
      'Production E2E target rejected',
    );
  });

  it.each([
    'not a url',
    'ftp://islanailsalon.com',
  ])('rejects an invalid external target: %s', (baseUrl) => {
    expect(() => assertAllowedE2ETarget(baseUrl, undefined)).toThrow(
      'E2E_BASE_URL must be a valid HTTP(S) URL',
    );
  });

  it('runs the Production check when E2E config loads', async () => {
    vi.stubEnv('E2E_BASE_URL', 'https://luster-production-alias.vercel.app');
    vi.stubEnv('E2E_ALLOW_PRODUCTION', '');
    vi.stubEnv('LUSTER_E2E_BLOCKED_HOSTS', 'luster-production-alias.vercel.app');
    vi.resetModules();

    await expect(import('../../tests/e2e/support/config')).rejects.toThrow(
      'Production E2E target rejected',
    );
  });

  it('runs the Production check when the global Playwright config loads', async () => {
    vi.stubEnv('E2E_BASE_URL', 'https://islanailsalon.com');
    vi.stubEnv('E2E_ALLOW_PRODUCTION', '');
    vi.resetModules();

    await expect(import('../../playwright.config')).rejects.toThrow(
      'Production E2E target rejected',
    );
  });

  it('guards the effective Playwright HOST target when E2E_BASE_URL is absent', async () => {
    vi.stubEnv('E2E_BASE_URL', '');
    vi.stubEnv('E2E_ALLOW_PRODUCTION', '');
    vi.stubEnv('LUSTER_E2E_BLOCKED_HOSTS', 'luster-production-alias.vercel.app');
    vi.stubEnv('HOST', 'luster-production-alias.vercel.app');
    vi.stubEnv('PORT', '80');
    vi.resetModules();

    await expect(import('../../playwright.config')).rejects.toThrow(
      'Production E2E target rejected',
    );
  });

  it('honors the exact config-load authorization escape hatch', async () => {
    vi.stubEnv('E2E_BASE_URL', 'https://luster-production-alias.vercel.app');
    vi.stubEnv('E2E_ALLOW_PRODUCTION', '1');
    vi.stubEnv('LUSTER_E2E_BLOCKED_HOSTS', 'luster-production-alias.vercel.app');
    vi.resetModules();

    await expect(import('../../tests/e2e/support/config')).resolves.toBeDefined();
  });
});
