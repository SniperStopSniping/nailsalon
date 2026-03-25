import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieGet, selectQueue, db, select, update, set } = vi.hoisted(() => {
  const cookieGet = vi.fn();
  const selectQueue: unknown[][] = [];
  const limit = vi.fn(async () => selectQueue.shift() ?? []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const set = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));
  const update = vi.fn(() => ({ set }));

  return {
    cookieGet,
    selectQueue,
    db: {
      select,
      update,
    },
    select,
    from,
    where,
    limit,
    update,
    set,
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
  })),
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

describe('requireStaffSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a validated session derived from the server-side session row', async () => {
    cookieGet.mockReturnValue({ value: 'staff_session_1' });
    selectQueue.push(
      [{
        id: 'staff_session_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      }],
      [{
        id: 'salon_1',
        slug: 'salon-a',
      }],
      [{
        id: 'tech_1',
        salonId: 'salon_1',
        name: 'Taylor',
        phone: '+15551234567',
      }],
    );

    const { requireStaffSession } = await import('./staffAuth');
    const result = await requireStaffSession();

    expect(result).toEqual({
      ok: true,
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
    });
    expect(select).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ lastSeenAt: expect.any(Date) });
  });

  it('returns unauthorized when the staff session cookie is missing', async () => {
    cookieGet.mockReturnValue(undefined);

    const { requireStaffSession } = await import('./staffAuth');
    const result = await requireStaffSession();

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected an unauthorized response');
    }

    expect(result.response.status).toBe(401);
    expect(select).not.toHaveBeenCalled();
  });
});
