/* eslint-disable import/first */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { requireSuperAdmin } = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('./adminAuth', () => ({ requireSuperAdmin }));

import { requireSuperAdminTestTools } from './superAdminTestTools.server';

const originalEnv = { ...process.env };

describe('requireSuperAdminTestTools', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('rejects production even when the flag is accidentally enabled', async () => {
    process.env = { ...process.env, NODE_ENV: 'production', VERCEL_ENV: 'production' };
    process.env.SUPER_ADMIN_TEST_TOOLS_ENABLED = 'true';
    requireSuperAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1', isSuperAdmin: true } });
    const result = await requireSuperAdminTestTools();

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it('requires a valid super-admin session in Preview', async () => {
    process.env = { ...process.env, NODE_ENV: 'production', VERCEL_ENV: 'preview' };
    process.env.SUPER_ADMIN_TEST_TOOLS_ENABLED = 'true';
    const response = Response.json({ error: 'unauthorized' }, { status: 401 });
    requireSuperAdmin.mockResolvedValue({ ok: false, response });
    const result = await requireSuperAdminTestTools();

    expect(result).toEqual({ ok: false, response });
  });
});
