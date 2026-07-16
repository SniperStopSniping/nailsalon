import { afterEach, describe, expect, it } from 'vitest';

import { buildSalonTenantPublicUrl } from './publicUrl';

const originalEnv = { ...process.env };

describe('server-generated salon canonical URLs', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses a verified custom domain without a slug path', () => {
    expect(buildSalonTenantPublicUrl('/book', {
      slug: 'isla-nails',
      customDomain: 'booking.islanails.example',
    })).toBe('https://booking.islanails.example/book');
  });

  it('uses the wildcard tenant hostname when a root domain is configured', () => {
    process.env.LUSTER_ROOT_DOMAIN = 'staging.luster.example';
    process.env.TENANT_SUBDOMAINS_ENABLED = 'true';

    expect(buildSalonTenantPublicUrl('/', { slug: 'isla-nails' }))
      .toBe('https://isla-nails.staging.luster.example/');
  });

  it('uses the safe path fallback until wildcard DNS is explicitly enabled', () => {
    process.env.LUSTER_ROOT_DOMAIN = 'islanailsalon.com';
    process.env.TENANT_SUBDOMAINS_ENABLED = 'false';
    process.env.NEXT_PUBLIC_APP_URL = 'https://islanailsalon.com';

    expect(buildSalonTenantPublicUrl('/book', { slug: 'best' }, 'en'))
      .toBe('https://islanailsalon.com/en/best/book');
  });

  it('uses locale and slug paths on Vercel Preview deployments', () => {
    delete process.env.LUSTER_ROOT_DOMAIN;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.VERCEL_URL = 'luster-git-feature-team.vercel.app';

    expect(buildSalonTenantPublicUrl('/book', { slug: 'isla-nails' }, 'en'))
      .toBe('https://luster-git-feature-team.vercel.app/en/isla-nails/book');
  });

  it('uses the local origin and tenant path in development', () => {
    process.env = { NODE_ENV: 'development' };

    expect(buildSalonTenantPublicUrl('/book', { slug: 'isla-nails' }, 'en'))
      .toBe('http://localhost:3000/en/isla-nails/book');
  });
});
