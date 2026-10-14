import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const context = { params: Promise.resolve({ reviewId: 'synthetic-id' }) };

const { requireAdminSalon, insert, update } = vi.hoisted(() => ({ requireAdminSalon: vi.fn(), insert: vi.fn(), update: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/DB', () => ({ db: { insert, update } }));

const request = (body: unknown = { salonSlug: 'synthetic-salon' }) => new Request('http://localhost/api/admin/reviews/synthetic-review/reward', { method: 'POST', body: JSON.stringify(body) });

describe('retired Google review rewards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({ salon: { id: 'synthetic-salon-id' }, error: null });
  });

  it('refuses new grants, including duplicate and concurrent requests, without financial writes', async () => {
    const responses = await Promise.all(Array.from({ length: 3 }, () => POST(request(), context)));

    expect(responses.map(response => response.status)).toEqual([410, 410, 410]);
    expect(await responses[0]!.json()).toMatchObject({ error: { code: 'REVIEW_REWARDS_RETIRED' } });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([401, 403])('preserves the %s owner/tenant denial', async (status) => {
    const denial = Response.json({ error: { code: 'FORBIDDEN' } }, { status });
    requireAdminSalon.mockResolvedValue({ salon: null, error: denial });

    expect(await POST(request(), context)).toBe(denial);
    expect(requireAdminSalon).toHaveBeenCalledWith('synthetic-salon');
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([{}, null, { salonSlug: '' }])('rejects malformed salon context %j before authorization', async (body) => {
    expect((await POST(request(body), context)).status).toBe(400);
    expect(requireAdminSalon).not.toHaveBeenCalled();
  });
});
