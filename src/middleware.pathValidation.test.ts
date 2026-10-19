import http from 'node:http';
import https from 'node:https';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import middleware from './middleware';

// Exercise the installed locale middleware and Clerk route matchers. Mocking
// next-intl here would miss the redirect that this regression protects against.
const origin = 'https://luster.invalid';
const event = {} as never;

function request(path: string, host = origin) {
  const url = new URL(path, host);
  return new NextRequest(url, { headers: { host: url.host } });
}

describe('middleware — request path validation', () => {
  beforeEach(() => {
    vi.stubEnv('LUSTER_ROOT_DOMAIN', 'luster.invalid');
    vi.stubEnv('PUBLIC_APP_URL', origin);
    vi.stubEnv('TENANT_SUBDOMAINS_ENABLED', 'true');
    const rejectNetwork = () => {
      throw new Error('Path validation tests must not contact external providers');
    };
    vi.stubGlobal('fetch', vi.fn(rejectNetwork));
    vi.spyOn(http, 'request').mockImplementation(rejectNetwork);
    vi.spyOn(http, 'get').mockImplementation(rejectNetwork);
    vi.spyOn(https, 'request').mockImplementation(rejectNetwork);
    vi.spyOn(https, 'get').mockImplementation(rejectNetwork);
  });

  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
    expect(https.get).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    '/en/%09/example.invalid/fixture',
    '/en/%0a/example.invalid/fixture',
    '/en/%0A/example.invalid/fixture',
    '/en/%0d/example.invalid/fixture',
    '/en/%0D/example.invalid/fixture',
    '/en/%09%0a%0d/example.invalid/fixture',
    '/fr/%09/example.invalid/fixture',
    '/%09/example.invalid/fixture',
    '/en/%5C%09/example.invalid/fixture',
    '/en/%09%2Fexample.invalid/fixture',
    '/en/about%09',
    '/en/%E9/about',
    '/en/%E0%A4%A/about',
    '/en/%/about',
  ])('rejects malformed path %s without a redirect, rewrite, or tenant cookie', async (path) => {
    const response = await middleware(request(path), event);

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).toBe('Invalid request path.');
  });

  it.each([
    '/admin/%09/fixture',
    '/onboarding-v1/%09/fixture',
    '/manage/%09/fixture',
    '/a/%09/fixture',
    '/api/admin/%09/fixture',
  ])('validates %s before auth, management-link, or API routing', async (path) => {
    const incoming = request(path);
    incoming.cookies.set('__session', 'synthetic-not-a-real-session');
    const response = await middleware(incoming, event);

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['%2509', '%250a', '%250D'])(
    'keeps the entire %s redirect chain on-origin until the invalid path is rejected',
    async (encodedControl) => {
      let incoming = request(`/en/${encodedControl}/example.invalid/fixture`);
      for (let hop = 0; hop < 5; hop += 1) {
        const response = await middleware(incoming, event);
        const location = response.headers.get('location');
        if (response.status === 400) {
          expect(location).toBeNull();
          expect(response.headers.get('x-middleware-rewrite')).toBeNull();

          return;
        }

        expect(location).not.toBeNull();

        const target = new URL(location!, incoming.url);

        expect(target.origin).toBe(origin);

        incoming = request(target.pathname + target.search);
      }
      throw new Error('Encoded path was not rejected within five local hops');
    },
  );

  it('keeps a still-encoded path on-origin when locale handling ends in a rewrite', async () => {
    const first = await middleware(request('/en/%252509/example.invalid/fixture'), event);
    const location = first.headers.get('location');

    expect(location).not.toBeNull();

    const target = new URL(location!);

    expect(target.origin).toBe(origin);

    const second = await middleware(request(target.pathname + target.search), event);

    expect(second.status).toBe(200);
    expect(second.headers.get('location')).toBeNull();

    const rewrite = second.headers.get('x-middleware-rewrite');

    expect(rewrite).not.toBeNull();
    expect(new URL(rewrite!).origin).toBe(origin);
  });

  it.each([
    ['/en/about', '/about'],
    ['/en/caf%C3%A9', '/caf%C3%A9'],
    ['/en/%5Cexample.invalid/fixture', '/%5Cexample.invalid/fixture'],
    ['/en///example.invalid/fixture', '/example.invalid/fixture'],
    ['/en/%2F%2Fexample.invalid/fixture', '/%2F%2Fexample.invalid/fixture'],
  ])('preserves the normal default-locale redirect for %s', async (path, destination) => {
    const response = await middleware(request(path), event);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(origin + destination);
  });

  it('preserves the French route and forwards its locale without an unnecessary rewrite', async () => {
    const response = await middleware(request('/fr/about'), event);

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    // v4 forwards a route already carrying its locale instead of rewriting it
    // to the identical URL. The request locale must still reach the renderer.
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-request-x-next-intl-locale')).toBe('fr');
  });

  it('preserves booking parameters and encoded control characters used only as query data', async () => {
    const query = '?serviceId=fixture&note=%09%0A%0D%2Fexample.invalid&discount=25%25';
    const response = await middleware(request(`/en/isla-nail-studio/book/service${query}`), event);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${origin}/isla-nail-studio/book/service${query}`);
    expect(response.cookies.get('__active_salon_slug')?.value).toBe('isla-nail-studio');
  });

  it.each(['/manage/SYNTHETIC_TOKEN', '/a/SYNTHETIC_TOKEN'])(
    'preserves host-relative management link %s',
    async (path) => {
      const response = await middleware(request(path), event);

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    },
  );

  it('preserves the intentional tenant-owner redirect to the canonical app', async () => {
    const response = await middleware(request('/admin?salon=isla', 'https://isla.luster.invalid'), event);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${origin}/admin?salon=isla`);
    expect(response.cookies.get('__active_salon_slug')?.value).toBe('isla');
  });

  it('rejects malformed tenant-owner paths before canonical redirection', async () => {
    const response = await middleware(request('/admin/%09/fixture', 'https://isla.luster.invalid'), event);

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('preserves the tenant public booking rewrite and selection', async () => {
    const response = await middleware(request('/book/service?serviceId=fixture', 'https://isla.luster.invalid'), event);

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://isla.luster.invalid/en/isla/book/service?serviceId=fixture');
    expect(response.cookies.get('__active_salon_slug')?.value).toBe('isla');
  });
});
