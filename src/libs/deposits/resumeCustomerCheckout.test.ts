import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), create: vi.fn(), retrieve: vi.fn(), budget: vi.fn(), confirm: vi.fn(), late: vi.fn(), set: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: { select: mocks.select, update: mocks.update } }));
vi.mock('@/libs/depositCheckout', () => ({ createDepositCheckoutSession: mocks.create, getDepositStripeClient: () => ({ checkout: { sessions: { retrieve: mocks.retrieve } } }) }));
vi.mock('./recoveryBudget', () => ({ authorizeDepositRecoveryRetrieval: mocks.budget }));
vi.mock('./confirmDepositPayment', () => ({ confirmDepositPayment: mocks.confirm }));
vi.mock('./lateDepositRecovery', () => ({ runLateDepositRecovery: mocks.late }));
const { resumeCustomerDepositCheckout } = await import('./resumeCustomerCheckout');

const row = {
  id: 'deposit',
  salonId: 'synthetic',
  appointmentId: 'appointment',
  amountCents: 2500,
  stripeAccountId: 'acct_synthetic',
  checkoutSuccessUrl: 'https://app.test/deposit/success',
  checkoutCancelUrl: 'https://app.test/deposit/cancel',
  sessionId: null,
  checkoutUrl: null,
  holdExpiresAt: new Date(Date.now() + 35 * 60_000),
  appointmentStartTime: new Date('2099-09-01T15:00:00Z'),
};
const session = () => ({ id: 'cs_original', url: 'https://checkout.stripe.com/c/pay/cs_original', status: 'open', payment_status: 'unpaid', payment_intent: null, metadata: { appointment_id: row.appointmentId, salon_id: row.salonId, deposit_id: row.id }, amount_total: row.amountCents, currency: 'cad', expires_at: Math.floor(row.holdExpiresAt.getTime() / 1000) });
function resultChain(rows: unknown[]) {
  const chain = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), limit: vi.fn(), then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  for (const method of ['from', 'innerJoin', 'where', 'limit'] as const) {
    chain[method].mockReturnValue(chain);
  }
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReturnValueOnce(resultChain([row])).mockReturnValueOnce(resultChain([{ name: 'Synthetic Service' }])).mockReturnValue(resultChain([{ id: 'appointment' }]));
  mocks.budget.mockResolvedValue(true);
  mocks.create.mockResolvedValue({ ok: true, session: session() });
  mocks.retrieve.mockResolvedValue(session());
  mocks.confirm.mockResolvedValue({ disposition: 'confirmed' });
  mocks.set.mockReturnValue({ where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'deposit' }]) })) });
  mocks.update.mockReturnValue({ set: mocks.set });
});

describe('resume original customer deposit checkout', () => {
  it('replays the immutable committed checkout inputs and never extends the original deadline', async () => {
    await expect(resumeCustomerDepositCheckout({ salonId: row.salonId, appointmentId: row.appointmentId })).resolves.toBe(session().url);

    expect(mocks.create).toHaveBeenCalledWith({ deposit: expect.objectContaining({ id: row.id, appointmentId: row.appointmentId, amountCents: 2500, stripeAccountId: row.stripeAccountId, holdExpiresAt: row.holdExpiresAt, checkoutSuccessUrl: row.checkoutSuccessUrl, serviceNameSnapshots: ['Synthetic Service'] }) });
    expect(mocks.budget).toHaveBeenCalledWith(row.id, row.salonId);
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it('retrieves the known session on its original connected account rather than creating', async () => {
    mocks.select.mockReset().mockReturnValueOnce(resultChain([{ ...row, sessionId: 'cs_original' }])).mockReturnValueOnce(resultChain([{ name: 'Synthetic Service' }])).mockReturnValue(resultChain([{ id: 'appointment' }]));
    await resumeCustomerDepositCheckout({ salonId: row.salonId, appointmentId: row.appointmentId });

    expect(mocks.retrieve).toHaveBeenCalledWith('cs_original', {}, { stripeAccount: 'acct_synthetic' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('persists a learned paid session after a lost response and hands evidence to canonical confirmation', async () => {
    mocks.create.mockResolvedValue({ ok: true, session: { ...session(), status: 'complete', payment_status: 'paid', payment_intent: 'pi_original', url: null } });

    await expect(resumeCustomerDepositCheckout({ salonId: row.salonId, appointmentId: row.appointmentId })).resolves.toBeNull();
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ stripeCheckoutSessionId: 'cs_original' }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ source: 'poll', sessionId: 'cs_original', connectedAccountId: 'acct_synthetic', paymentStatus: 'paid', paymentIntentId: 'pi_original' }));
  });

  it('cannot erase an existing payment intent with a stale unpaid response', async () => {
    await resumeCustomerDepositCheckout({ salonId: row.salonId, appointmentId: row.appointmentId });
    const query = new PgDialect().sqlToQuery(mocks.set.mock.calls[0]![0].stripePaymentIntentId);

    expect(query.sql).toContain('COALESCE("appointment_deposit"."stripe_payment_intent_id",');
    expect(query.params).toEqual([null]);
  });

  it('does not call Stripe when the existing durable provider budget is exhausted', async () => {
    mocks.budget.mockResolvedValue(false);

    await expect(resumeCustomerDepositCheckout({ salonId: row.salonId, appointmentId: row.appointmentId })).resolves.toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it('rejects mismatched provider evidence before attaching a session', async () => {
    mocks.create.mockResolvedValue({ ok: true, session: { ...session(), metadata: { ...session().metadata, salon_id: 'other-salon' } } });

    await expect(resumeCustomerDepositCheckout({ salonId: row.salonId, appointmentId: row.appointmentId })).resolves.toBeNull();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('does not return a checkout when the hold ceased to be live during provider recovery', async () => {
    mocks.select.mockReset().mockReturnValueOnce(resultChain([row])).mockReturnValueOnce(resultChain([{ name: 'Synthetic Service' }])).mockReturnValue(resultChain([]));

    await expect(resumeCustomerDepositCheckout({ salonId: row.salonId, appointmentId: row.appointmentId })).resolves.toBeNull();
  });
});
