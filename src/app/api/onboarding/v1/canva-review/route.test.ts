import { SetupError } from '@/features/business-setup/contracts';

import { POST } from './route';

const state = vi.hoisted(() => ({ enabled: true, signedIn: true, owner: true, allowed: true, prepare: vi.fn() }));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({ isOnboardingV1IntegrationEnabled: () => state.enabled }));
vi.mock('@/libs/adminAuth', () => ({ getAdminSession: async () => state.signedIn ? { id: 'real-session-owner' } : null }));
vi.mock('@/features/onboarding-v1-integration/media-authorization.server', () => ({ authorizeOnboardingSite: async () => state.owner ? { adminId: 'real-session-owner', salonId: 'authorized-salon' } : null }));
vi.mock('@/features/custom-sites/onboarding-canva.server', () => ({ importOnboardingCanva: state.prepare }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: () => ({ allowed: state.allowed, retryAfterMs: 1000 }), rateLimitResponse: () => new Response(null, { status: 429 }) }));
const input = { siteId: 'a0000000-0000-4000-8000-000000000001', expectedRevision: 2 };
const request = (body: unknown = input) => new Request('https://builder.example/api/onboarding/v1/canva-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.signedIn = true;
  state.owner = true;
  state.allowed = true;
  state.prepare.mockResolvedValue({ head: { salonSlug: 'owned-salon', revision: { revision: 3 } } });
});

it('creates only the authorized owner draft and returns minimum review navigation data', async () => {
  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ data: { salonSlug: 'owned-salon', revision: 3 } });
  expect(state.prepare).toHaveBeenCalledWith({ salonId: 'authorized-salon', adminId: 'real-session-owner' }, input);
});

it.each(['enabled', 'signedIn', 'owner'] as const)('denies unavailable access through %s before importing anything', async (key) => {
  state[key] = false;

  expect((await POST(request())).status).toBe(key === 'signedIn' ? 401 : 404);
  expect(state.prepare).not.toHaveBeenCalled();
});

it.each([{ ...input, salonId: 'other-salon' }, { ...input, publish: true }, { ...input, expectedRevision: 0 }, { ...input, siteId: 'invalid' }])('rejects browser-selected authority and malformed data %j', async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(state.prepare).not.toHaveBeenCalled();
});

it('bounds the body even without a Content-Length header', async () => {
  expect((await POST(new Request('https://builder.example/api/onboarding/v1/canva-review', { method: 'POST', body: ' '.repeat(8193) }))).status).toBe(413);
  expect(state.prepare).not.toHaveBeenCalled();
});

it('returns a stale-draft conflict without publishing or claiming success', async () => {
  state.prepare.mockRejectedValueOnce(new SetupError('STALE', 'Your saved website changed. Reload the latest version.'));
  const response = await POST(request());

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: { code: 'STALE', message: 'Your saved website changed. Reload the latest version.' } });
});

it('does not expose internal diagnostics when preparation fails', async () => {
  state.prepare.mockRejectedValueOnce(new Error('private-storage-key-and-database-diagnostic'));
  const response = await POST(request());

  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private-storage-key');
});

it('limits repeated owner requests without reading uploads or creating drafts', async () => {
  state.allowed = false;
  const response = await POST(request());

  expect(response.status).toBe(429);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(state.prepare).not.toHaveBeenCalled();
});
