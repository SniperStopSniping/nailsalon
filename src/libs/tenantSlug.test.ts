import { afterEach, describe, expect, it } from 'vitest';

import {
  getSalonSlugFromHostname,
  getSalonSlugFromPathname,
  getSalonSlugFromRouteParams,
  getSalonSlugFromSearchParams,
  isReservedSalonSlug,
  isTenantSubdomainSlugEnabled,
  isValidSalonSlug,
  normalizeSalonSlug,
} from './tenantSlug';

const originalEnv = { ...process.env };

describe('tenantSlug helpers', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('normalizes slugs consistently', () => {
    expect(normalizeSalonSlug('  Luster  ')).toBe('luster');
    expect(normalizeSalonSlug('')).toBeNull();
  });

  it('prefers slug params from dynamic routes', () => {
    expect(getSalonSlugFromRouteParams({ slug: 'luster' })).toBe('luster');
    expect(getSalonSlugFromRouteParams({ slug: ['luster', 'extra'] })).toBe('luster');
    expect(getSalonSlugFromRouteParams({ locale: 'en' })).toBeNull();
  });

  it('reads legacy salonSlug search params', () => {
    expect(getSalonSlugFromSearchParams({ salonSlug: 'luster' })).toBe('luster');
    expect(getSalonSlugFromSearchParams(new URLSearchParams('salonSlug=luster'))).toBe('luster');
  });

  it('extracts salon slugs from localized tenant paths only', () => {
    expect(getSalonSlugFromPathname('/en/luster', ['en', 'fr'])).toBe('luster');
    expect(getSalonSlugFromPathname('/en/ab', ['en', 'fr'])).toBe('ab');
    expect(getSalonSlugFromPathname('/en/luster/book/service', ['en', 'fr'])).toBe('luster');
    expect(getSalonSlugFromPathname('/en/book/service', ['en', 'fr'])).toBeNull();
    expect(getSalonSlugFromPathname('/en/join/token', ['en', 'fr'])).toBeNull();
    expect(getSalonSlugFromPathname('/en/owner-sign-in', ['en', 'fr'])).toBeNull();
    expect(getSalonSlugFromPathname('/luster', ['en', 'fr'])).toBeNull();
  });

  it.each([
    'manage',
    'owner',
    'pay',
    'privacy',
    'terms',
    'www',
    'api',
  ])('does not extract the reserved system route %s as a salon slug', (slug) => {
    expect(getSalonSlugFromPathname(`/en/${slug}`, ['en', 'fr'])).toBeNull();
  });

  it('resolves wildcard tenant hosts without treating system hosts as salons', () => {
    expect(getSalonSlugFromHostname('islanailsalon.luster.com', 'luster.com')).toBe('islanailsalon');
    expect(getSalonSlugFromHostname('ISLANAILSALON.LUSTER.COM:443', 'luster.com')).toBe('islanailsalon');
    expect(getSalonSlugFromHostname('www.luster.com', 'luster.com')).toBeNull();
    expect(getSalonSlugFromHostname('api.luster.com', 'luster.com')).toBeNull();
    expect(getSalonSlugFromHostname('manage.luster.com', 'luster.com')).toBeNull();
    expect(getSalonSlugFromHostname('owner.luster.com', 'luster.com')).toBeNull();
    expect(getSalonSlugFromHostname('nested.isla.luster.com', 'luster.com')).toBeNull();
    expect(getSalonSlugFromHostname('unrelated.example.com', 'luster.com')).toBeNull();
  });

  it('validates permanent salon slugs and reserves Luster system names', () => {
    expect(isValidSalonSlug('isla-nails')).toBe(true);
    expect(isValidSalonSlug('a')).toBe(true);
    expect(isValidSalonSlug('ab')).toBe(true);
    expect(isValidSalonSlug('a'.repeat(47))).toBe(true);
    expect(isValidSalonSlug('a'.repeat(48))).toBe(false);
    expect(isValidSalonSlug('-isla')).toBe(false);
    expect(isValidSalonSlug('isla-')).toBe(false);
    expect(isValidSalonSlug('Isla Nails')).toBe(false);
  });

  it.each([
    'manage',
    'owner',
    'pay',
    'privacy',
    'terms',
    'www',
    'api',
    'support',
    'clerk',
    'accounts',
  ])('reserves %s for Luster system routes or subdomains', (slug) => {
    expect(isReservedSalonSlug(slug)).toBe(true);
    expect(isValidSalonSlug(slug)).toBe(false);
  });

  it('allows an individually verified tenant hostname during wildcard rollout', () => {
    process.env.TENANT_SUBDOMAINS_ENABLED = 'false';
    process.env.TENANT_SUBDOMAIN_ALLOWLIST = 'best,pilot-two';

    expect(isTenantSubdomainSlugEnabled('best')).toBe(true);
    expect(isTenantSubdomainSlugEnabled('unverified')).toBe(false);
  });
});
