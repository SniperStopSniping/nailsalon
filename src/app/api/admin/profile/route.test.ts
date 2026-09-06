import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAdminSession, db, set, limit } = vi.hoisted(() => {
  const returning = vi.fn(async () => [
    {
      id: 'admin_1',
      phoneE164: '+14165550100',
      name: 'Renamed Owner',
      email: 'owner@example.com',
      isSuperAdmin: false,
    },
  ]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const limit = vi.fn(async (): Promise<unknown[]> => []);
  const selectWhere = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));

  return {
    getAdminSession: vi.fn(),
    db: { update, select },
    set,
    limit,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  getAdminSession,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

/* eslint-disable import/first */
import { GET, POST } from './route';
/* eslint-enable import/first */

const profileRequest = (body: unknown) =>
  new Request('http://localhost/api/admin/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const signedInAdmin = {
  id: 'admin_1',
  phoneE164: '+14165550100',
  name: 'Audit Owner',
  email: 'owner@example.com',
  isSuperAdmin: false,
  salons: [],
};

describe('/api/admin/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSession.mockResolvedValue(signedInAdmin);
  });

  // AG-w2-settings-integrations-09
  it('returns the stored address so the Account view can show it', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.email).toBe('owner@example.com');
    expect(body.user.emailEditable).toBe(false);
  });

  it('rejects an anonymous read', async () => {
    getAdminSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  // AG-w2-settings-integrations-09: a name-only edit must not require the
  // address to be retyped.
  it('saves the name on its own', async () => {
    const response = await POST(profileRequest({ name: 'Renamed Owner' }));

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith({ name: 'Renamed Owner' });
  });

  it('accepts the stored address as a confirmation', async () => {
    const response = await POST(
      profileRequest({ name: 'Renamed Owner', email: 'OWNER@example.com ' }),
    );

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith({ name: 'Renamed Owner' });
  });

  // AG-w2-settings-integrations-08: the address is an identity-adoption key for
  // Clerk sign-in and the destination of owner alerts. This route has no
  // verification step, so it must never rewrite it.
  it('refuses to rewrite the address to a different one', async () => {
    const response = await POST(
      profileRequest({ name: 'Renamed Owner', email: 'attacker@example.com' }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('EMAIL_READ_ONLY');
    expect(set).not.toHaveBeenCalled();
  });

  // The legacy phone-admin onboarding step still needs to set a first address.
  it('sets a first address when the account has none', async () => {
    getAdminSession.mockResolvedValue({ ...signedInAdmin, email: null });

    const response = await POST(
      profileRequest({ name: 'New Owner', email: 'New.Owner@example.com' }),
    );

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith({
      name: 'New Owner',
      email: 'new.owner@example.com',
    });
  });

  it('refuses a first address another admin already uses', async () => {
    getAdminSession.mockResolvedValue({ ...signedInAdmin, email: null });
    limit.mockResolvedValueOnce([{ id: 'admin_2' }]);

    const response = await POST(
      profileRequest({ name: 'New Owner', email: 'taken@example.com' }),
    );

    expect(response.status).toBe(409);
    expect(set).not.toHaveBeenCalled();
  });
});
