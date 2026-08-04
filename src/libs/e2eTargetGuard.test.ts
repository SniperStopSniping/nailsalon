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
    expect(() => assertAllowedE2ETarget(baseUrl, undefined)).not.toThrow();
  });

  it.each([
    'https://islanailsalon.com',
    'https://www.islanailsalon.com/path',
    'https://ISLANAILSALON.COM./book',
  ])('rejects the Production host at config load: %s', (baseUrl) => {
    expect(() => assertAllowedE2ETarget(baseUrl, undefined)).toThrow(
      'Production E2E target rejected',
    );
  });

  it('allows Production only with the exact owner-authorization value', () => {
    expect(() => assertAllowedE2ETarget('https://islanailsalon.com', '1')).not.toThrow();
    expect(() => assertAllowedE2ETarget('https://islanailsalon.com', 'true')).toThrow(
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
    vi.stubEnv('E2E_BASE_URL', 'https://www.islanailsalon.com');
    vi.stubEnv('E2E_ALLOW_PRODUCTION', '');
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
    vi.stubEnv('HOST', 'islanailsalon.com');
    vi.stubEnv('PORT', '80');
    vi.resetModules();

    await expect(import('../../playwright.config')).rejects.toThrow(
      'Production E2E target rejected',
    );
  });

  it('honors the exact config-load authorization escape hatch', async () => {
    vi.stubEnv('E2E_BASE_URL', 'https://islanailsalon.com');
    vi.stubEnv('E2E_ALLOW_PRODUCTION', '1');
    vi.resetModules();

    await expect(import('../../tests/e2e/support/config')).resolves.toBeDefined();
  });
});
