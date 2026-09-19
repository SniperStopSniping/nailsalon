import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, resolve, overview, suppress } = vi.hoisted(() => ({ auth: vi.fn(), resolve: vi.fn(), overview: vi.fn(), suppress: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: auth }));
vi.mock('@/libs/clientLifecycleStabilization', () => ({ resolveOperationalSalonClientContactWithHandle: resolve }));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/reviewRequests.server', () => ({ getClientReviewOverview: overview, setReviewSuppression: suppress }));
const url = 'http://localhost/api/admin/clients/client-a/review-requests?salonSlug=salon-a';
const params = { params: Promise.resolve({ id: 'client-a' }) };

describe('salon-scoped client review history route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ salon: { id: 'salon-a' }, error: null });
    resolve.mockResolvedValue({ id: 'resolved-client-a' });
    overview.mockResolvedValue({ reviewRequestsSuppressed: false, timeZone: 'America/Toronto', history: [{ id: 'request-a', status: 'sent' }], hasMore: false });
  });

  it('returns private history for the authenticated salon and resolved client only', async () => {
    const { GET } = await import('./route');
    const response = await GET(new Request(url), params);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(overview).toHaveBeenCalledWith('salon-a', 'resolved-client-a');
    expect((await response.json()).data.history).toEqual([{ id: 'request-a', status: 'sent' }]);
  });

  it('does not query review history when a client cannot resolve inside the salon', async () => {
    resolve.mockRejectedValue(new Error('wrong tenant'));
    const { GET } = await import('./route');

    expect((await GET(new Request(url), params)).status).toBe(404);
    expect(overview).not.toHaveBeenCalled();
  });

  it('retains the existing suppression action and returns refreshed authoritative history', async () => {
    const { PATCH } = await import('./route');
    const response = await PATCH(new Request(url, { method: 'PATCH', body: JSON.stringify({ reviewRequestsSuppressed: true }) }), params);

    expect(response.status).toBe(200);
    expect(suppress).toHaveBeenCalledWith('salon-a', 'resolved-client-a', true);
    expect(overview).toHaveBeenCalledWith('salon-a', 'resolved-client-a');
  });

  it('preserves the owner authorization boundary before resolving a client', async () => {
    auth.mockResolvedValue({ error: new Response(null, { status: 403 }), salon: null });
    const { GET } = await import('./route');

    expect((await GET(new Request(url), params)).status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
    expect(overview).not.toHaveBeenCalled();
  });
});
