import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clientLifecycleMutationsEnabled,
  requireClientManagerSalon,
} from './clientManagementAuth';

const { getAdminSession, requireAdminSalon } = vi.hoisted(() => ({
  getAdminSession: vi.fn(),
  requireAdminSalon: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({
  getAdminSession,
  requireAdminSalon,
}));

vi.mock('server-only', () => ({}));

const salon = {
  id: 'salon_1',
  slug: 'salon-one',
};

describe('clientLifecycleMutationsEnabled', () => {
  it('defaults production off while keeping Preview/test on', () => {
    expect(clientLifecycleMutationsEnabled({
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
    })).toBe(false);
    expect(clientLifecycleMutationsEnabled({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
    })).toBe(true);
    expect(clientLifecycleMutationsEnabled({
      NODE_ENV: 'test',
    })).toBe(true);
  });

  it('honors an explicit rollout override', () => {
    expect(clientLifecycleMutationsEnabled({
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      CLIENT_LIFECYCLE_MUTATIONS_ENABLED: 'true',
    })).toBe(true);
    expect(clientLifecycleMutationsEnabled({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      CLIENT_LIFECYCLE_MUTATIONS_ENABLED: 'false',
    })).toBe(false);
  });
});

describe('requireClientManagerSalon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['owner', 'owner'],
    ['admin', 'admin'],
  ] as const)('allows an authenticated %s for the authorized salon', async (role, expectedRole) => {
    getAdminSession.mockResolvedValue({
      id: `admin_${role}`,
      isSuperAdmin: false,
      salons: [{
        salonId: salon.id,
        salonSlug: salon.slug,
        salonName: 'Salon One',
        role,
      }],
    });

    const result = await requireClientManagerSalon(salon.slug);

    expect(result).toEqual({
      ok: true,
      salon,
      actor: {
        id: `admin_${role}`,
        role: expectedRole,
      },
    });
    expect(requireAdminSalon).toHaveBeenCalledWith(salon.slug);
  });

  it('denies a staff membership without exposing salon data', async () => {
    getAdminSession.mockResolvedValue({
      id: 'admin_staff',
      isSuperAdmin: false,
      salons: [{
        salonId: salon.id,
        salonSlug: salon.slug,
        salonName: 'Salon One',
        role: 'staff',
      }],
    });

    const result = await requireClientManagerSalon(salon.slug);

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error('Expected staff authorization to fail');
    }

    expect(result.response.status).toBe(403);
    expect(result.response.headers.get('cache-control')).toContain('private');
    expect(result.response.headers.get('cache-control')).toContain('no-store');
    await expect(result.response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Owner or admin access is required',
      },
    });
  });

  it('keeps authorized production mutations closed until explicit activation', async () => {
    vi.stubEnv('CLIENT_LIFECYCLE_MUTATIONS_ENABLED', 'false');
    getAdminSession.mockResolvedValue({
      id: 'admin_owner',
      isSuperAdmin: false,
      salons: [{
        salonId: salon.id,
        salonSlug: salon.slug,
        salonName: 'Salon One',
        role: 'owner',
      }],
    });

    const result = await requireClientManagerSalon(salon.slug);

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error('Expected disabled lifecycle authorization to fail');
    }

    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toEqual({
      error: {
        code: 'CLIENT_LIFECYCLE_NOT_ENABLED',
        message: 'Client merge and archive controls are not enabled yet.',
      },
    });
  });

  it('returns the tenant guard response without loading the admin session', async () => {
    const tenantResponse = Response.json(
      { error: { code: 'NOT_FOUND', message: 'Salon not found' } },
      { status: 404 },
    );
    requireAdminSalon.mockResolvedValue({
      error: tenantResponse,
      salon: null,
    });

    const result = await requireClientManagerSalon('foreign-salon');

    expect(result).toEqual({
      ok: false,
      response: tenantResponse,
    });
    expect(getAdminSession).not.toHaveBeenCalled();
  });
});
