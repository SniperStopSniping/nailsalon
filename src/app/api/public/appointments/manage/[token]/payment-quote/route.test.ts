import { beforeEach, describe, expect, it, vi } from 'vitest';

import { calculatePaymentSnapshot } from '@/libs/customerPayments/money';

import { POST } from './route';

const mocks = vi.hoisted(() => ({ enabled: false, prepare: vi.fn(), db: {} }));
vi.mock('@/libs/customerPayments/preparationGate', () => ({ isCustomerPaymentPreparationEnabled: () => mocks.enabled }));
vi.mock('@/libs/DB', () => ({ db: mocks.db }));
vi.mock('@/libs/customerPayments/server/prepareQuoteForToken', () => ({ prepareCustomerPaymentQuoteForToken: mocks.prepare }));

const token = 'c'.repeat(43);
const requestId = 'c061cc9f-384f-4e0c-8e31-1f1daea06210';
const params = { params: Promise.resolve({ token }) };
const validBody = { requestId, tipCents: 0 };

function request(body: unknown = validBody, origin = 'http://localhost:3000') {
  return new Request(`http://localhost:3000/api/public/appointments/manage/${token}/payment-quote`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.prepare.mockResolvedValue({
    id: 'quote_fixture',
    fingerprint: 'a'.repeat(64),
    expiresAt: new Date('2030-01-01T12:05:00Z'),
    snapshot: calculatePaymentSnapshot({ currency: 'cad', servicesCents: 10000, discountCents: 0, taxCents: 1300, tipCents: 0, collection: 'full' }),
    stripeAccountId: 'acct_private',
    context: { capability: { tokenId: 'private-capability-identity' } },
  });
});

describe('customer payment quote API', () => {
  it('does not reach the service when disabled', async () => {
    mocks.enabled = false;
    const response = await POST(request(), params);

    expect(response.status).toBe(404);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it.each(['null', '', 'https://foreign.invalid', 'http://localhost:3000/'])('rejects nonexact origin %s', async (origin) => {
    expect((await POST(request(validBody, origin), params)).status).toBe(403);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('rejects cross-site metadata and malformed capabilities before reading state', async () => {
    const crossSite = request();
    crossSite.headers.set('sec-fetch-site', 'cross-site');

    expect((await POST(crossSite, params)).status).toBe(403);
    expect((await POST(request(), { params: Promise.resolve({ token: 'short' }) })).status).toBe(404);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it.each([
    { ...validBody, amountCents: 1 },
    { ...validBody, salonId: 'foreign' },
    { ...validBody, tipCents: -1 },
    { ...validBody, tipCents: 0.5 },
    { ...validBody, tipCents: '100' },
    { ...validBody, tipCents: 50000001 },
    { ...validBody, requestId: 'not-an-id' },
    { ...validBody, currency: 'usd' },
  ])('accepts no client authority or invalid money %j', async (body) => {
    expect((await POST(request(body), params)).status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it.each(['text/plain', 'application/jsonp', ''])('requires JSON media type %s', async (contentType) => {
    const incoming = request();
    incoming.headers.set('content-type', contentType);

    expect((await POST(incoming, params)).status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('bounds an untrusted body even with a misleading Content-Length', async () => {
    const oversized = request({ ...validBody, padding: 'x'.repeat(5000) });
    oversized.headers.set('content-length', '1');

    expect((await POST(oversized, params)).status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('returns only nonexecutable public totals from persisted server material', async () => {
    const response = await POST(request(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(mocks.db, token, validBody);
    expect(body.data).toMatchObject({ quoteId: 'quote_fixture', testOnly: true, collectionEnabled: false, executable: false, currency: 'CAD', dueNowCents: 11300, customerFeeCents: 0 });
    expect(JSON.stringify(body)).not.toMatch(/acct_private|private-capability|context|stripeAccountId/);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it.each([
    ['CUSTOMER_PAYMENT_ACCESS_REQUIRED', 404, 'APPOINTMENT_NOT_FOUND'],
    ['CUSTOMER_PAYMENT_QUOTE_STALE', 409, 'QUOTE_REVIEW_REQUIRED'],
    ['CUSTOMER_PAYMENT_QUOTE_REPLAY_CONFLICT', 409, 'QUOTE_REVIEW_REQUIRED'],
    ['CUSTOMER_PAYMENT_DRAFT_DISABLED', 409, 'PAYMENT_QUOTE_UNAVAILABLE'],
    ['CUSTOMER_PAYMENT_PREPARATION_DISABLED', 404, 'NOT_FOUND'],
    ['SQL error containing private details', 503, 'PAYMENT_PREPARATION_UNAVAILABLE'],
  ])('maps %s without exposing server details', async (error, status, code) => {
    mocks.prepare.mockRejectedValue(new Error(String(error)));
    const response = await POST(request(), params);

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });
});
