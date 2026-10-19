import { beforeEach, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ enabled: vi.fn(), identity: vi.fn(), open: vi.fn() }));
vi.mock('@/features/business-setup/access.server', () => ({ businessSetupSelfServeEnabled: state.enabled }));
vi.mock('@/features/business-setup/entry.server', () => ({ openAiBuilder: state.open }));
vi.mock('@/features/onboarding-v1-integration/identity.server', () => ({ requireAuthenticatedOnboardingIdentity: state.identity }));
const owner = { clerkUserId: 'verified-owner', email: 'owner@example.invalid', verifiedEmail: 'owner@example.invalid', name: null, phoneE164: null };
const request = (body: unknown = {}, origin = 'http://localhost:3197') => new Request('http://localhost:3197/api/admin/business-setup/entry', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled.mockReturnValue(true);
  state.identity.mockResolvedValue(owner);
  state.open.mockResolvedValue({ kind: 'ready', slug: 'private-studio' });
});

it('uses only the verified identity, accepts an optional selected slug, and never accepts browser identity or funding', async () => {
  expect((await POST(request({ salonSlug: 'owned' }))).status).toBe(200);
  expect(state.open).toHaveBeenCalledWith(owner, 'owned');

  state.open.mockClear();
  for (const body of [{ adminId: 'other' }, { userId: 'other' }, { credits: 100 }, { salonId: 'other' }]) {
    expect((await POST(request(body))).status).toBe(400);
  }

  expect(state.open).not.toHaveBeenCalled();
});

it('rejects disabled and cross-origin entry before resolving private account information', async () => {
  state.enabled.mockReturnValue(false);

  expect((await POST(request())).status).toBe(404);

  state.enabled.mockReturnValue(true);

  expect((await POST(request({}, 'https://other.invalid'))).status).toBe(403);
  expect(state.identity).not.toHaveBeenCalled();
});

it('bounds the streamed body without a Content-Length and does not create anything after an auth failure', async () => {
  expect((await POST(request({ salonSlug: 'a'.repeat(600) }))).status).toBe(413);

  state.identity.mockRejectedValueOnce(new Error('Private provider error must not leak'));
  const response = await POST(request());

  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('Private provider');
  expect(state.open).not.toHaveBeenCalled();
});
