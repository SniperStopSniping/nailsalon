import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), resolve: vi.fn(), limit: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin: mocks.guard }));
vi.mock('@/libs/networkNoShowReview.server', () => ({ resolveNoShowReviewInTx: mocks.resolve }));
vi.mock('@/libs/DB', () => ({ db: { transaction: (run: (tx: object) => unknown) => run({}) } }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: mocks.limit, rateLimitResponse: () => new Response(null, { status: 429 }) }));

const body = { salonId: 'source', appointmentId: 'appointment', expectedUpdatedAt: '2030-06-15T18:30:00Z', decision: 'upheld', reason: 'Original confirmation evidence verified.' };
function request(value = body) {
  return new Request('http://localhost/api/super-admin/network-no-show/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, admin: { id: 'operator' } });
  mocks.resolve.mockResolvedValue(true);
  mocks.limit.mockReturnValue({ allowed: true });
});

describe('restricted no-show review resolution', () => {
  it('rejects non-platform callers before reading any review', async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });

    expect((await POST(request())).status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('requires a bounded reason and an expected source version', async () => {
    expect((await POST(request({ ...body, reason: '' }))).status).toBe(400);
    expect((await POST(request({ ...body, expectedUpdatedAt: 'invalid' }))).status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('audits the authenticated operator and surfaces stale/moderated conflicts', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith({}, expect.objectContaining({ ...body, operatorId: 'operator' }));

    mocks.resolve.mockResolvedValue(false);

    expect((await POST(request())).status).toBe(409);
  });

  it('limits review writes', async () => {
    mocks.limit.mockReturnValue({ allowed: false });

    expect((await POST(request())).status).toBe(429);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
