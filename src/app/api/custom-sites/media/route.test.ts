import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const guards = vi.hoisted(() => ({ admin: vi.fn(), read: vi.fn(), rate: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ getAdminSession: guards.admin }));
vi.mock('@/libs/rateLimit', () => ({ getClientIp: () => 'synthetic-ip', checkEndpointRateLimit: guards.rate }));
vi.mock('@/features/custom-sites/native-media-access.server', () => ({ readAuthorizedCanvaNativeMedia: guards.read }));

const input = { artifactId: 'a0000000-0000-4000-8000-000000000001', mediaId: 'b0000000-0000-4000-8000-000000000001' };
const request = (body = JSON.stringify(input), headers: Record<string, string> = {}) => new Request('https://luster.example/api/custom-sites/media', { method: 'POST', headers: { 'origin': 'https://luster.example', 'content-type': 'application/json', ...headers }, body });

beforeEach(() => {
  vi.clearAllMocks();
  guards.admin.mockResolvedValue({ id: 'authenticated-owner' });
  guards.read.mockResolvedValue(Buffer.from([82, 73, 70, 70]));
  guards.rate.mockReturnValue({ allowed: true });
});

describe('native website photo HTTP boundary', () => {
  it('passes the authenticated actor separately and returns only noncached image bytes', async () => {
    const response = await POST(request());

    expect(guards.read).toHaveBeenCalledWith(input, 'authenticated-owner');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(4);
  });

  it('permits guest authorization through the domain and conceals an unavailable image', async () => {
    guards.admin.mockResolvedValue(null);
    guards.read.mockResolvedValue(null);
    const response = await POST(request());

    expect(guards.read).toHaveBeenCalledWith(input, undefined);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('rejects foreign origins and cross-site requests before authentication or reads', async () => {
    const attempts: Record<string, string>[] = [{ origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }];
    for (const headers of attempts) {
      expect((await POST(request(undefined, headers))).status).toBe(403);
    }

    expect(guards.admin).not.toHaveBeenCalled();
    expect(guards.read).not.toHaveBeenCalled();
  });

  it('bounds actual streamed bytes even without a declared size', async () => {
    expect((await POST(request('x'.repeat(1025)))).status).toBe(413);
    expect((await POST(request('x', { 'content-length': '5000' }))).status).toBe(413);
    expect(guards.read).not.toHaveBeenCalled();
  });

  it('returns a bounded retry delay without starting a media read', async () => {
    guards.rate.mockReturnValue({ allowed: false, retryAfterMs: 2500 });
    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3');
    expect(guards.read).not.toHaveBeenCalled();
  });

  it('does not expose storage errors, request capabilities or private metadata', async () => {
    guards.read.mockRejectedValue(new Error('private storage location and token'));
    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });
});
