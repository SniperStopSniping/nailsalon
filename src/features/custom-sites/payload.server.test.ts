import { afterEach, describe, expect, it, vi } from 'vitest';

import { customSiteRendererOrigin } from './payload.server';

vi.mock('server-only', () => ({}));
vi.mock('./artifacts.server', () => ({ assertCustomArtifact: vi.fn() }));
vi.mock('./assets.server', () => ({ assetDataUrl: vi.fn() }));
vi.mock('@/libs/DB', () => ({ db: {} }));

afterEach(() => vi.unstubAllEnvs());

describe('separate renderer site', () => {
  it.each([
    ['https://admin.example.co.uk', 'https://render.example.co.uk', null],
    ['https://admin.example.com', 'https://render.example.com', null],
    ['https://one.vercel.app', 'https://two.vercel.app', 'https://two.vercel.app'],
    ['https://one.vercel.app', 'https://nested.one.vercel.app', null],
    ['https://one.vercel.app', 'https://two.vercel.app/other', null],
  ])('checks the public and private suffix list: %s %s', (parent, render, result) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', parent);
    vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', render);
    vi.stubEnv('CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED', 'true');

    expect(customSiteRendererOrigin()).toBe(result);
  });

  it('requires explicit isolation verification even with distinct hosts', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://one.vercel.app');
    vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', 'https://two.vercel.app');
    vi.stubEnv('CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED', 'false');

    expect(customSiteRendererOrigin()).toBeNull();
  });
});
