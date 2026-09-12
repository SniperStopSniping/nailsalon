import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
const transport = vi.hoisted(() => ({ pi: vi.fn(), charge: vi.fn(), refunds: vi.fn(), refund: vi.fn(), disputes: vi.fn() }));
vi.mock('@/libs/stripe', () => ({ stripe: {
  paymentIntents: { retrieve: transport.pi },
  charges: { retrieve: transport.charge },
  refunds: { list: transport.refunds, retrieve: transport.refund },
  disputes: { list: transport.disputes },
} }));
const { stripeShadowProvider } = await import('./shadowObserver');
const context = () => ({ account: 'acct_original', livemode: false, deadline: Date.now() + 10_000, signal: new AbortController().signal });
const refund = () => ({ id: 're_original', object: 'refund', amount: 500, currency: 'cad', charge: 'ch_original', payment_intent: 'pi_original', status: 'requires_action', created: 1, next_action: { type: 'display_details', private_url: 'excluded' }, failure_balance_transaction: 'txn_failure', metadata: { salon_id: 'forged' }, instructions_email: 'excluded@example.invalid' });

describe('R1 pinned SDK response projection through the actual read-only adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transport.pi.mockResolvedValue({ id: 'pi_original', livemode: false, status: 'succeeded', latest_charge: 'ch_original', amount: 2500, amount_received: 2500 });
    transport.charge.mockResolvedValue({ id: 'ch_original', livemode: false, payment_intent: 'pi_original', paid: true, captured: true, amount: 2500, amount_captured: 2500, amount_refunded: 500, disputed: false, currency: 'cad', lastResponse: { requestId: 'req_charge' } });
    transport.refunds.mockResolvedValue({ data: [refund()], has_more: false });
    transport.refund.mockResolvedValue(refund());
  });

  it('accepts Refund DTO without nonexistent livemode, retains action/failure identity, and minimizes PII', async () => {
    const ctx = context();

    expect((await stripeShadowProvider.collection('pi_original', ctx)).fact.captured).toBe(true);

    const page = await stripeShadowProvider.refunds('ch_original', null, ctx);

    expect(page.data[0]).toMatchObject({ id: 're_original', status: 'requires_action', nextActionType: 'display_details', failureBalanceTransaction: 'txn_failure' });
    expect(page.data[0]).not.toHaveProperty('metadata');
    expect(page.data[0]).not.toHaveProperty('instructions_email');
    expect(page.data[0]).not.toHaveProperty('next_action');
    expect(transport.refunds).toHaveBeenCalledWith({ charge: 'ch_original', limit: 100 }, expect.objectContaining({ stripeAccount: 'acct_original', maxNetworkRetries: 0 }));
  });

  it('rejects returned charge/PI/mode mismatches and recognizes incomplete capture', async () => {
    transport.charge.mockResolvedValueOnce({ id: 'ch_foreign', livemode: false });

    await expect(stripeShadowProvider.collection('pi_original', context())).rejects.toThrow('provider_identity_conflict');

    transport.pi.mockResolvedValueOnce({ id: 'pi_foreign', livemode: false });

    await expect(stripeShadowProvider.collection('pi_original', context())).rejects.toThrow('provider_identity_conflict');

    transport.pi.mockResolvedValueOnce({ id: 'pi_original', livemode: true });

    await expect(stripeShadowProvider.collection('pi_original', context())).rejects.toThrow('provider_scope_conflict');

    transport.pi.mockResolvedValueOnce({ id: 'pi_original', livemode: false, status: 'requires_capture', latest_charge: 'ch_original', amount: 2500, amount_received: 0 });

    expect((await stripeShadowProvider.collection('pi_original', context())).fact.captured).toBe(false);
  });

  it('keeps exact retrieval identity and never falls back to a platform-scoped request', async () => {
    transport.refund.mockResolvedValueOnce({ ...refund(), id: 're_foreign' });

    await expect(stripeShadowProvider.refund('re_original', context())).rejects.toThrow('provider_identity_conflict');

    await stripeShadowProvider.refund('re_original', context());

    expect(transport.refund).toHaveBeenLastCalledWith('re_original', {}, expect.objectContaining({ stripeAccount: 'acct_original' }));
  });

  it('does not start requests after the shared deadline or cancellation', async () => {
    await expect(stripeShadowProvider.collection('pi_original', { ...context(), deadline: Date.now() })).rejects.toThrow('observation_deadline');

    const controller = new AbortController();
    controller.abort();

    await expect(stripeShadowProvider.collection('pi_original', { ...context(), signal: controller.signal })).rejects.toThrow('observation_deadline');
    expect(transport.pi).not.toHaveBeenCalled();
  });
});
