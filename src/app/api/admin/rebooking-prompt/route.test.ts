import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PATCH } from './route';

const h = vi.hoisted(() => ({ require: vi.fn(), session: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: h.require, getAdminSession: h.session }));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/models/Schema', () => ({ salonSchema: {} }));

const request = (method: 'GET' | 'PATCH', body?: unknown) => new Request('http://luster.test/api/admin/rebooking-prompt?salonSlug=isla', {
  method,
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('rebooking prompt settings API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the existing-salon off default when the additive setting is missing', async () => {
    h.require.mockResolvedValueOnce({ salon: { id: 'salon-a', settings: null } });
    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { settings: { enabled: false } } });
  });

  it('checks tenant authorization before accepting a mutation', async () => {
    h.require.mockResolvedValueOnce({ error: Response.json({}, { status: 403 }) });
    const response = await PATCH(request('PATCH', { enabled: true }));

    expect(response.status).toBe(403);
    expect(h.session).not.toHaveBeenCalled();
  });

  it('rejects unknown or partial payloads before attempting a write', async () => {
    h.require.mockResolvedValueOnce({ salon: { id: 'salon-a' } });
    h.session.mockResolvedValueOnce({ id: 'admin-a' });
    const response = await PATCH(request('PATCH', { enabled: true, other: true }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
