import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ guard: vi.fn(), clients: vi.fn(), receipt: vi.fn(), preview: vi.fn(), queue: vi.fn(), sms: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: mocks.guard }));
vi.mock('@/libs/bulkClientMessages.server', () => ({ getBulkMessageClients: mocks.clients, getBulkMessageReceipt: mocks.receipt, previewBulkClientMessage: mocks.preview, queueBulkClientMessage: mocks.queue }));
vi.mock('@/libs/clientMessaging', () => ({ ClientMessagingError: class extends Error {} }));
vi.mock('@/libs/integrationHealth', () => ({ getSalonSmsReadiness: mocks.sms }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: () => ({ allowed: true }), getClientIp: () => 'test', rateLimitResponse: vi.fn() }));
vi.mock('@/libs/publicUrl', () => ({ buildSalonTenantPublicUrl: () => 'https://isla.test/book' }));
const body = { action: 'send', salonSlug: 'isla', clientIds: ['a', 'b'], message: 'Book your next visit', filter: { minWeeks: 3, excludeUpcoming: true }, requestId: '6c4b8c94-3e4d-4a60-bf46-26f806cedf98', previewFingerprint: 'a'.repeat(64) };
const send = (data: unknown = body, origin = 'https://luster.test') => new Request('https://luster.test/api/admin/messages/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': origin }, body: JSON.stringify(data) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ salon: { id: 'authorized-salon', slug: 'isla', settings: null }, error: null });
  mocks.clients.mockResolvedValue([]);
  mocks.sms.mockResolvedValue({ manualAvailable: true });
  mocks.queue.mockResolvedValue({ queued: 2 });
  mocks.preview.mockResolvedValue({ totalCredits: 2 });
});

describe('bulk messages route', () => {
  it('requires an exact origin and rejects malformed sends before accessing client data', async () => {
    const { POST } = await import('./route');

    expect((await POST(send(body, 'https://evil.test'))).status).toBe(403);
    expect((await POST(send({ ...body, clientIds: ['a', 'a'] }))).status).toBe(400);
    expect((await POST(send({ ...body, clientIds: Array.from({ length: 1001 }, (_, i) => String(i)) }))).status).toBe(400);
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it('uses server-authorized tenancy for preview, enqueue and delivery status', async () => {
    const { GET, POST } = await import('./route');
    const { requestId: _requestId, previewFingerprint: _fingerprint, ...draft } = body;

    expect((await POST(send({ ...draft, action: 'preview' }))).status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith('authorized-salon', expect.objectContaining({ clientIds: ['a', 'b'] }));
    expect(mocks.queue).not.toHaveBeenCalled();
    expect((await POST(send())).status).toBe(202);
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ salonId: 'authorized-salon', requestId: body.requestId }));

    await GET(new Request(`https://luster.test/api/admin/messages/bulk?salonSlug=isla&requestId=${body.requestId}`));

    expect(mocks.receipt).toHaveBeenCalledWith('authorized-salon', body.requestId);
  });

  it('rejects unauthorized reads and writes without loading any audience', async () => {
    const { GET, POST } = await import('./route');
    mocks.guard.mockResolvedValue({ salon: null, error: new Response(null, { status: 403 }) });

    expect((await POST(send())).status).toBe(403);
    expect((await GET(new Request('https://luster.test/api/admin/messages/bulk?salonSlug=other'))).status).toBe(403);
    expect(mocks.clients).not.toHaveBeenCalled();
    expect(mocks.sms).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
