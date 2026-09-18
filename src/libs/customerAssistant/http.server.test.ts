import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ salon: vi.fn(), guard: vi.fn(), online: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/queries', () => ({ getSalonBySlug: mocks.salon }));
vi.mock('@/libs/salonStatus', () => ({ guardSalonApiRoute: mocks.guard, isOnlineBookingEnabled: mocks.online }));
const { isCustomerSameOrigin, readCustomerJson, resolveCustomerAssistantSalon } = await import('./http.server');

beforeEach(() => {
  vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('OPENAI_API_KEY_CUSTOMER', 'test-customer');
  vi.stubEnv('CUSTOMER_ASSISTANT_SIGNING_SECRET', 'x'.repeat(32));
  vi.clearAllMocks();
  mocks.salon.mockResolvedValue({ id: 'salon-a', slug: 'isla-nail-studio', publicationStatus: 'published' });
  mocks.guard.mockResolvedValue(null);
  mocks.online.mockResolvedValue(true);
});

describe('customer public HTTP boundary', () => {
  it('stays dark for another salon and disabled global switch before any DB read', async () => {
    expect(await resolveCustomerAssistantSalon('foreign-salon')).toBeNull();

    vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'false');

    expect(await resolveCustomerAssistantSalon('isla-nail-studio')).toBeNull();
    expect(mocks.salon).not.toHaveBeenCalled();
  });

  it('requires published public booking even when cookies might identify an owner', async () => {
    expect(await resolveCustomerAssistantSalon('isla-nail-studio')).toMatchObject({ id: 'salon-a' });

    mocks.salon.mockResolvedValue({ id: 'salon-a', slug: 'isla-nail-studio', publicationStatus: 'draft' });

    expect(await resolveCustomerAssistantSalon('isla-nail-studio')).toBeNull();

    mocks.salon.mockResolvedValue({ id: 'salon-a', slug: 'isla-nail-studio', publicationStatus: 'published' });
    mocks.online.mockResolvedValue(false);

    expect(await resolveCustomerAssistantSalon('isla-nail-studio')).toBeNull();
  });

  it('rejects cross-site requests and bounds actual streamed bytes', async () => {
    expect(isCustomerSameOrigin(new Request('https://app.test/api', { headers: { origin: 'https://evil.test' } }))).toBe(false);
    expect(isCustomerSameOrigin(new Request('https://app.test/api', { headers: { origin: 'https://app.test' } }))).toBe(true);

    const request = new Request('https://app.test/api', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1' }, body: JSON.stringify({ message: 'x'.repeat(30001) }) });

    expect(await readCustomerJson(request)).toBeNull();
  });
});
