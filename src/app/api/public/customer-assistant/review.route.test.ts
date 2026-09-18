import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ salon: vi.fn(), guard: vi.fn(), online: vi.fn(), review: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/queries', () => ({ getSalonBySlug: mocks.salon }));
vi.mock('@/libs/salonStatus', () => ({ guardSalonApiRoute: mocks.guard, isOnlineBookingEnabled: mocks.online }));
vi.mock('@/libs/customerAssistant/review.server', () => ({ prepareCustomerAssistantReview: mocks.review }));
vi.mock('@/libs/publicBookingRateLimit.server', () => ({ getPublicBookingClientIp: () => '192.0.2.5' }));

const { POST } = await import('./[salonSlug]/review/route');
const context = (slug = 'isla-nail-studio') => ({ params: Promise.resolve({ salonSlug: slug }) });
const request = (body: unknown, origin = 'https://app.test') => new Request('https://app.test/api/public/customer-assistant/isla-nail-studio/review', {
  method: 'POST',
  headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('OPENAI_API_KEY_CUSTOMER', 'synthetic');
  vi.stubEnv('CUSTOMER_ASSISTANT_SIGNING_SECRET', 'x'.repeat(32));
  mocks.salon.mockResolvedValue({ id: 'salon-a', slug: 'isla-nail-studio', name: 'Isla', publicationStatus: 'published', features: null, settings: {} });
  mocks.guard.mockResolvedValue(null);
  mocks.online.mockResolvedValue(true);
  mocks.review.mockResolvedValue({ conversation: 'next', result: { kind: 'unavailable', reason: 'unavailable' } });
});

describe('customer assistant review route', () => {
  it('passes normalized contact only to the request-scoped review backend', async () => {
    const response = await POST(request({ conversation: 'signed', contact: { name: ' Ava ', email: 'AVA@example.com', phone: '+1 (416) 555-0101' } }), context());

    expect(response.status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({
      salon: expect.objectContaining({ id: 'salon-a', slug: 'isla-nail-studio' }),
      contact: { name: 'Ava', email: 'ava@example.com', phone: '4165550101' },
      clientIp: '192.0.2.5',
    }));
  });

  it('rejects cross-site, tenant override, and invalid guest contact before review work', async () => {
    expect((await POST(request({}, 'https://attacker.test'), context())).status).toBe(403);
    expect((await POST(request({ conversation: 'signed', contact: { name: 'Ava', email: 'ava@example.com', phone: '555-0101' } }), context())).status).toBe(400);
    expect((await POST(request({ conversation: 'signed', contact: { name: 'Ava', email: 'ava@example.com', phone: '4165550101' }, salonId: 'salon-b' }), context())).status).toBe(400);
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it('keeps review dark for non-pilot salons and disabled configuration', async () => {
    expect((await POST(request({ conversation: 'signed', contact: { name: 'Ava', email: 'ava@example.com', phone: '4165550101' } }), context('other-salon'))).status).toBe(404);

    vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'false');

    expect((await POST(request({ conversation: 'signed', contact: { name: 'Ava', email: 'ava@example.com', phone: '4165550101' } }), context())).status).toBe(404);
    expect(mocks.review).not.toHaveBeenCalled();
  });
});
