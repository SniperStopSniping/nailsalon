import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPaymentReturnUrl, paymentReturnSigningKeyHash } from '@/libs/customerPayments/server/paymentReturnToken';

import { POST } from './route';

const h = vi.hoisted(() => ({ read: vi.fn(), limit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/customerPayments/server/workspaceRepository', () => ({ createPaymentWorkspaceRepository: () => ({ readReturnStatus: h.read }) }));
vi.mock('@/libs/customerAssistant/http.server', () => ({ readCustomerJson: (request: Request) => request.json() }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: h.limit, getClientIp: () => '127.0.0.1' }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CUSTOMER_PAYMENTS_STATUS_SIGNING_SECRET', 'synthetic-return-status-fixture-'.repeat(2));
  h.limit.mockReturnValue({ allowed: true });
  h.read.mockResolvedValue({ status: 'pending', currency: 'CAD', amountCents: 4500, refundedCents: 0 });
});

afterEach(() => vi.unstubAllEnvs());

const origin = 'https://preview.example.invalid';
function token() {
  const url = createPaymentReturnUrl({ salonId: 'salon_fixture', appointmentId: 'appointment_fixture' }, { id: randomUUID(), kind: 'payment', createdAt: Date.now(), returnStatusKeyHash: paymentReturnSigningKeyHash()!, binding: { returnOrigin: origin, currency: 'cad', bindingId: 'binding', platformAccountId: 'acct_platform', connectedAccountId: 'acct_connected', livemode: false } });
  return new URLSearchParams(new URL(url).hash.slice(1)).get('status')!;
}
const request = (body: unknown, requestOrigin = origin) => new Request(`${origin}/api/public/payments/status?result=success`, { method: 'POST', headers: { 'Origin': requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('read-only public payment status', () => {
  it('returns only repository-verified status with private response headers', async () => {
    const credential = token();
    const response = await POST(request({ token: credential }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'pending', currency: 'CAD', amountCents: 4500, refundedCents: 0 } });
    expect(h.read).toHaveBeenCalledWith(credential, origin);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects forged capabilities, extra fields and cross-origin reads before database access', async () => {
    expect((await POST(request({ token: 'forged' }))).status).toBe(404);
    expect((await POST(request({ token: token(), status: 'received' }))).status).toBe(404);
    expect((await POST(request({ token: token() }, 'https://unrelated.example.invalid'))).status).toBe(403);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('handles unavailable records and infrastructure without disclosing errors or tokens', async () => {
    h.read.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('private database detail'));

    expect((await POST(request({ token: token() }))).status).toBe(404);

    const response = await POST(request({ token: token() }));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private database|salon_fixture/);
  });

  it('rate limits before database reads', async () => {
    h.limit.mockReturnValue({ allowed: false });

    expect((await POST(request({ token: token() }))).status).toBe(429);
    expect(h.read).not.toHaveBeenCalled();
  });
});
