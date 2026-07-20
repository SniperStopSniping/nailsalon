import { describe, expect, it } from 'vitest';

import { buildLusterUrl, isApprovedLusterUrl, LUSTER_ORIGIN, LUSTER_PATHS } from './lusterLinks';

describe('lusterLinks', () => {
  it('points every approved path at the lusterstudio.ca brand domain', () => {
    expect(LUSTER_ORIGIN).toBe('https://lusterstudio.ca');

    for (const path of LUSTER_PATHS) {
      const url = buildLusterUrl(path);

      expect(url.startsWith(`https://lusterstudio.ca${path}?`)).toBe(true);
      expect(url).not.toMatch(/luster\.com/);
      expect(isApprovedLusterUrl(url)).toBe(true);
    }
  });

  it('carries owner-dashboard attribution on built links', () => {
    expect(buildLusterUrl('/shop')).toBe(
      'https://lusterstudio.ca/shop?utm_source=luster_booking&utm_medium=owner_dashboard&utm_campaign=free_booking',
    );
  });

  it.each([
    ['the retired brand domain', 'https://luster.com/shop'],
    ['a host that merely starts with the brand domain', 'https://lusterstudio.ca.example.com/shop'],
    ['a subdomain of the brand domain', 'https://shop.lusterstudio.ca/shop'],
    ['an insecure scheme', 'http://lusterstudio.ca/shop'],
    ['an unapproved path', 'https://lusterstudio.ca/learn/does-not-exist'],
    ['an open redirect style path', 'https://lusterstudio.ca/redirect?to=https://evil.example.com'],
    ['a relative link', '/shop'],
    ['a javascript url', 'javascript:alert(1)'],
    ['an empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(isApprovedLusterUrl(url)).toBe(false);
  });
});
