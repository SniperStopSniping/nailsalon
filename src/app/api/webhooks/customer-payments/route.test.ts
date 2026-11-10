import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ retain: vi.fn(), associate: vi.fn(), reconcile: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/customerPayments/server/workspaceRepository', () => ({ createPaymentWorkspaceRepository: () => ({ retainReceipt: mocks.retain, associateReceipt: mocks.associate }) }));
vi.mock('@/libs/customerPayments/server/workspaceDispatcher', () => ({ reconcileWorkspacePayment: mocks.reconcile }));

const { POST } = await import('./route');
const secret = `whsec_${'webhookfixture'.repeat(3)}`;

function request(patch: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ id: 'evt_route', object: 'event', account: 'acct_salon', api_version: '2024-06-20', livemode: false, type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), data: { object: { id: 'cs_test_route', object: 'checkout.session', metadata: {} } }, ...patch });
  return new Request('https://example.invalid/api/webhooks/customer-payments', { method: 'POST', body: payload, headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret }) } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_ENV', 'test');
  vi.stubEnv('STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET', secret);
  vi.stubEnv('CUSTOMER_PAYMENTS_STRIPE_WEBHOOK_ENDPOINT_ID', 'we_fixture');
  vi.stubEnv('CUSTOMER_PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID', 'acct_platform');
  vi.stubEnv('STRIPE_SECRET_KEY', ['sk', 'test', 'not-a-provider-credential'].join('_'));
  mocks.retain.mockResolvedValue({ receiptId: 'receipt', collision: false });
  mocks.associate.mockResolvedValue({ scope: { salonId: 'salon', appointmentId: 'appointment' }, operationId: 'operation', held: false });
  mocks.reconcile.mockResolvedValue({});
});

describe('real-signature customer payment ingress with mocked persistence', () => {
  it('retains the signed receipt before awaited reconciliation and acknowledgement', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.retain.mock.invocationCallOrder[0]!).toBeLessThan(mocks.associate.mock.invocationCallOrder[0]!);
    expect(mocks.associate.mock.invocationCallOrder[0]!).toBeLessThan(mocks.reconcile.mock.invocationCallOrder[0]!);
    expect(mocks.retain.mock.calls[0]![0]).toMatchObject({ financialPostingAllowed: false, accountId: 'acct_salon' });
  });

  it('asks Stripe to retry when storage or independent verification fails', async () => {
    mocks.retain.mockRejectedValueOnce(new Error('database unavailable'));

    expect((await POST(request())).status).toBe(503);
    expect(mocks.reconcile).not.toHaveBeenCalled();

    mocks.reconcile.mockRejectedValueOnce(new Error('provider timeout'));

    expect((await POST(request())).status).toBe(503);
    expect(mocks.retain).toHaveBeenCalledTimes(2);
  });

  it('acknowledges an explicitly retained review hold without posting money', async () => {
    mocks.associate.mockResolvedValue({ held: true });

    expect((await POST(request())).status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('rejects missing signatures, mode crossings, oversize bodies, and missing configuration', async () => {
    expect((await POST(new Request('https://example.invalid', { method: 'POST', body: '{}' }))).status).toBe(400);
    expect((await POST(request({ livemode: true }))).status).toBe(400);
    expect((await POST(new Request('https://example.invalid', { method: 'POST', body: 'x'.repeat(512 * 1024 + 1), headers: { 'stripe-signature': 'irrelevant' } }))).status).toBe(413);

    vi.stubEnv('STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET', '');

    expect((await POST(request())).status).toBe(503);
    expect(mocks.retain).not.toHaveBeenCalled();
  });
});
