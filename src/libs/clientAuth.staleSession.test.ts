/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cookies,
  dbSelect,
  dbUpdate,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies }));
vi.mock('@/libs/DB', () => ({
  db: {
    select: dbSelect,
    update: dbUpdate,
  },
}));

import { getClientSession } from './clientAuth';

describe('legacy client sessions are never authoritative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['no cookie', undefined],
    ['unknown id', 'does-not-exist'],
    ['expired id', 'expired-session'],
    ['valid-looking UUID', '018f0f5d-7b35-7db2-8eaa-3bf24a25f975'],
    ['malformed value', '\' OR 1=1 --'],
  ])('returns null without reading cookies or PostgreSQL for %s', async (_label, _value) => {
    await expect(getClientSession()).resolves.toBeNull();

    expect(cookies).not.toHaveBeenCalled();
    expect(dbSelect).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});
