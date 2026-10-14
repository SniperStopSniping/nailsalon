import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const context = { params: Promise.resolve({ id: 'synthetic-id' }) };

const { requireAdminSalon, sendStaffInvite } = vi.hoisted(() => ({ requireAdminSalon: vi.fn(), sendStaffInvite: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/SMS', () => ({ sendStaffInvite }));

const request = () => new Request('http://localhost/api/admin/technicians/synthetic-tech/invite', { method: 'POST', body: JSON.stringify({ salonSlug: 'synthetic-salon' }) });

describe('unavailable staff invitations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an older owner screen without sending a login link', async () => {
    requireAdminSalon.mockResolvedValue({ salon: { id: 'synthetic-salon-id' }, error: null });
    const response = await POST(request(), context);

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: 'STAFF_ACCESS_UNAVAILABLE' } });
    expect(sendStaffInvite).not.toHaveBeenCalled();
  });

  it.each([401, 403])('preserves owner and tenant denial %s', async (status) => {
    const denial = Response.json({}, { status });
    requireAdminSalon.mockResolvedValue({ salon: null, error: denial });

    expect(await POST(request(), context)).toBe(denial);
    expect(sendStaffInvite).not.toHaveBeenCalled();
  });
});
