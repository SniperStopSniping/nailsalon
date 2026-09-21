import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ salon: vi.fn(), facts: vi.fn() }));

vi.mock('@/libs/customerAssistant/http.server', () => ({
  CUSTOMER_NO_STORE: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  resolveCustomerAssistantSalon: mocks.salon,
}));
vi.mock('@/libs/customerAssistant/publicFacts.server', () => ({ loadCustomerPublicFacts: mocks.facts }));

const { GET } = await import('./[salonSlug]/prices/route');

const context = (salonSlug = 'isla-nail-studio') => ({ params: Promise.resolve({ salonSlug }) });
const request = (url = 'https://app.test/api/public/customer-assistant/isla-nail-studio/prices') => new Request(url);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.salon.mockResolvedValue({ id: 'salon-isla', slug: 'isla-nail-studio', features: { customerAssistant: true } });
  mocks.facts.mockResolvedValue({
    salon: { name: 'Isla Nail Studio' },
    catalogue: {
      currency: 'CAD',
      services: [{ id: 'gel-x', name: 'Gel-X Extensions', description: 'Flexible extensions.', category: 'extensions', durationMinutes: 105, price: { baseCents: 8500, baseDisplay: '$85.00', displayLabel: null, range: null } }],
      addOns: [{ id: 'private-note', name: 'Must not be returned' }],
    },
  });
});

describe('customer assistant public prices route', () => {
  it('uses only the route-resolved salon and returns the public catalogue without a session or model', async () => {
    const response = await GET(request('https://app.test/api/public/customer-assistant/isla-nail-studio/prices?locale=fr&salonId=other-salon'), context());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.facts).toHaveBeenCalledWith({ salonId: 'salon-isla', salonSlug: 'isla-nail-studio', features: { customerAssistant: true }, locale: 'fr' });
    expect(await response.json()).toEqual({
      salon: { name: 'Isla Nail Studio' },
      catalogue: {
        currency: 'CAD',
        services: [{ id: 'gel-x', name: 'Gel-X Extensions', description: 'Flexible extensions.', category: 'extensions', durationMinutes: 105, price: { baseCents: 8500, baseDisplay: '$85.00', displayLabel: null, range: null } }],
      },
    });
  });

  it('returns the same disabled response for another tenant and does not load catalogue data', async () => {
    mocks.salon.mockResolvedValue(null);

    const response = await GET(request('https://app.test/api/public/customer-assistant/other-salon/prices'), context('other-salon'));

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.facts).not.toHaveBeenCalled();
  });
});
