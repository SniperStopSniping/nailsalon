import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_COOKIE_NAME, readDevRoleFromCookies } from './devRole.server';

const { readCookies } = vi.hoisted(() => ({ readCookies: vi.fn() }));

vi.mock('next/headers', () => ({ cookies: readCookies }));

describe('async development role cookies', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('APP_ENV', 'development');
    readCookies.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('awaits the Next.js request cookies before reading the role', async () => {
    const get = vi.fn(() => ({ value: 'admin' }));
    readCookies.mockResolvedValue({ get });

    await expect(readDevRoleFromCookies()).resolves.toBe('admin');
    expect(get).toHaveBeenCalledWith(DEV_COOKIE_NAME);
  });

  it('never reads a role override in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(readDevRoleFromCookies()).resolves.toBeNull();
    expect(readCookies).not.toHaveBeenCalled();
  });

  it('rejects an unknown role', async () => {
    readCookies.mockResolvedValue({ get: () => ({ value: 'unknown' }) });

    await expect(readDevRoleFromCookies()).resolves.toBeNull();
  });

  it('does not grant a role when the request cookie context is unavailable', async () => {
    readCookies.mockRejectedValue(new Error('Request context unavailable'));

    await expect(readDevRoleFromCookies()).resolves.toBeNull();
  });
});
