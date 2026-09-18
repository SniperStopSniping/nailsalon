import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ salon: vi.fn(), guard: vi.fn(), online: vi.fn(), turn: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/queries', () => ({ getSalonBySlug: mocks.salon }));
vi.mock('@/libs/salonStatus', () => ({ guardSalonApiRoute: mocks.guard, isOnlineBookingEnabled: mocks.online }));
vi.mock('@/libs/customerAssistant/turn.server', () => ({ runCustomerAssistantTurn: mocks.turn }));
vi.mock('@/libs/publicBookingRateLimit.server', () => ({ getPublicBookingClientIp: () => '192.0.2.5' }));

const { POST: session } = await import('./[salonSlug]/session/route');
const { POST: chat } = await import('./[salonSlug]/chat/route');
const { verifyCustomerConversation } = await import('@/libs/customerAssistant/conversation.server');
const context = (slug = 'isla-nail-studio') => ({ params: Promise.resolve({ salonSlug: slug }) });
function request(body?: unknown, origin = 'https://app.test') {
  return new Request('https://app.test/api/public/customer-assistant/isla-nail-studio/chat', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('OPENAI_API_KEY_CUSTOMER', 'synthetic-customer');
  vi.stubEnv('CUSTOMER_ASSISTANT_SIGNING_SECRET', 'x'.repeat(32));
  mocks.salon.mockResolvedValue({ id: 'salon-a', slug: 'isla-nail-studio', publicationStatus: 'published', features: null });
  mocks.guard.mockResolvedValue(null);
  mocks.online.mockResolvedValue(true);
  mocks.turn.mockResolvedValue({ conversation: 'next', result: { kind: 'unavailable', reason: 'no_match' } });
});

describe('customer assistant public routes', () => {
  it('binds issued capability to the route-resolved salon and disables caching', async () => {
    const response = await session(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(verifyCustomerConversation(body.conversation, 'salon-a', 'x'.repeat(32)).turnIndex).toBe(0);
    expect(() => verifyCustomerConversation(body.conversation, 'salon-b', 'x'.repeat(32))).toThrow();
  });

  it('returns indistinguishable 404 for the dark feature and other salons', async () => {
    expect((await session(request(), context('salon-b'))).status).toBe(404);
    expect((await chat(request(), context('salon-b'))).status).toBe(404);

    vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'false');

    expect((await session(request(), context())).status).toBe(404);
    expect((await chat(request(), context())).status).toBe(404);
    expect(mocks.salon).not.toHaveBeenCalled();
    expect(mocks.turn).not.toHaveBeenCalled();
  });

  it('rejects foreign origins, tenant overrides, privileged state and oversized bodies', async () => {
    expect((await chat(request({}, 'https://attacker.test'), context())).status).toBe(403);
    expect((await session(request({}, 'https://attacker.test'), context())).status).toBe(403);
    expect((await chat(request({ conversation: 'signed', message: 'hello', locale: 'en', salonId: 'salon-b' }), context())).status).toBe(400);
    expect((await chat(request({ message: 'x'.repeat(31_000) }), context())).status).toBe(400);
    expect(mocks.turn).not.toHaveBeenCalled();
  });

  it('passes only server-resolved tenant context to the bounded interpreter', async () => {
    const response = await chat(request({ conversation: 'signed', message: 'French', locale: 'en' }), context());

    expect(response.status).toBe(200);
    expect(mocks.turn).toHaveBeenCalledWith({ salonId: 'salon-a', features: null, conversation: 'signed', message: 'French', locale: 'en', clientIp: '192.0.2.5' });
  });
});
