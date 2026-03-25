import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireActiveAdminSalon, db, setSelectResults, updateSet } = vi.hoisted(() => {
  let selectResults: unknown[][] = [];

  const setSelectResults = (nextResults: unknown[][]) => {
    selectResults = [...nextResults];
  };

  const updateSet = vi.fn();

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: updateSet.mockImplementation(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{
            id: 'signal_1',
            resolvedAt: new Date('2026-03-14T12:00:00.000Z'),
            resolvedBy: 'admin_1',
            resolutionNote: 'Looks legitimate',
          }]),
        })),
      })),
    })),
  };

  return {
    requireActiveAdminSalon: vi.fn(),
    db,
    setSelectResults,
    updateSet,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireActiveAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { PATCH } from './route';

describe('PATCH /api/admin/fraud-signals/[id]/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSelectResults([]);
  });

  it('rejects unauthorized admins', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
      admin: null,
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/fraud-signals/signal_1/resolve', {
        method: 'PATCH',
      }),
      { params: { id: 'signal_1' } },
    );

    expect(response.status).toBe(401);
  });

  it('resolves signals using the active salon and acting admin', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active' },
      admin: { id: 'admin_1' },
    });
    setSelectResults([[
      {
        id: 'signal_1',
        salonId: 'salon_active',
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      },
    ]]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/fraud-signals/signal_1/resolve', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Looks legitimate' }),
      }),
      { params: { id: 'signal_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedBy: 'admin_1',
        resolutionNote: 'Looks legitimate',
      }),
    );
    expect(body.data.alreadyResolved).toBe(false);
    expect(body.data.signal.resolvedBy).toBe('admin_1');
  });
});
