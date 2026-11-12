import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculatePaymentSnapshot } from '../money';
import { openCustomerPaymentRehearsalStore } from './rehearsalStore';

vi.mock('server-only', () => ({}));

const runtime = { featureEnabled: true, deploymentEnvironment: 'test', stripeMode: 'test' };
const snapshot = calculatePaymentSnapshot({ currency: 'cad', collection: 'full', servicesCents: 10000, taxCents: 1300, discountCents: 0, tipCents: 2000 });
const input = { referenceId: 'attempt1', salonId: 'salon1', appointmentId: 'appointment1', stripeAccountId: 'acct_test1', snapshot, expiresAt: 2000 };
const session = { id: 'cs_test_1', stripeAccountId: input.stripeAccountId, livemode: false };
const evidence = { eventId: 'evt_1', stripeAccountId: input.stripeAccountId, livemode: false, referenceId: input.referenceId, sessionId: session.id, status: 'succeeded' as const, currency: 'cad', amountCents: snapshot.chargeCents, applicationFeeCents: snapshot.applicationFeeCents, paymentIntentId: 'pi_1', observedAt: 1000 };
const directories: string[] = [];
const stores: Awaited<ReturnType<typeof openCustomerPaymentRehearsalStore>>[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'luster-payment-rehearsal-'));
  directories.push(directory);
  const store = await openCustomerPaymentRehearsalStore(directory, runtime);
  stores.push(store);
  return { store, directory };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const store of stores.splice(0)) {
    await store.close();
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('isolated durable payment rehearsal', () => {
  it('fails closed before accessing a database path', async () => {
    await expect(openCustomerPaymentRehearsalStore('/not/a/database', {})).rejects.toThrow('CUSTOMER_PAYMENTS_DISABLED');
    await expect(openCustomerPaymentRehearsalStore(tmpdir(), runtime)).rejects.toThrow('ISOLATED_REHEARSAL_DIRECTORY_REQUIRED');
    await expect(openCustomerPaymentRehearsalStore(tmpdir(), { ...runtime, stripeMode: 'live' })).rejects.toThrow('CUSTOMER_PAYMENTS_DISABLED');
  });

  it('refuses production even with explicitly enabled test configuration', async () => {
    for (const name of ['NODE_ENV', 'VERCEL_ENV', 'APP_ENV']) {
      vi.stubEnv(name, 'production');

      await expect(openCustomerPaymentRehearsalStore('/not/a/database', runtime)).rejects.toThrow('CUSTOMER_PAYMENTS_DISABLED');

      vi.unstubAllEnvs();
    }
  });

  it('rejects live and foreign account evidence without changing pending state', async () => {
    const { store } = await fixture();
    await store.prepare(input);
    await store.bind(input.referenceId, input.salonId, 0, session);

    expect(() => store.observe(input.salonId, 1, { ...evidence, livemode: true })).toThrow('LIVE_EVIDENCE_FORBIDDEN');
    await expect(store.observe(input.salonId, 1, { ...evidence, stripeAccountId: 'acct_other' })).rejects.toThrow('PAYMENT_ACCOUNT_MISMATCH');
    expect((await store.read(input.referenceId, input.salonId)).phase).toBe('checkout_open');

    await store.observe(input.salonId, 1, evidence);
    const other = { ...input, referenceId: 'attempt2', appointmentId: 'appointment2' };
    await store.prepare(other);
    await store.bind(other.referenceId, other.salonId, 0, { ...session, id: 'cs_test_2' });

    await expect(store.observe(other.salonId, 1, { ...evidence, referenceId: other.referenceId, sessionId: 'cs_test_2' })).rejects.toThrow('PAYMENT_RECEIPT_CONFLICT');
    await expect(store.observe(other.salonId, 1, { ...evidence, eventId: 'evt_2', referenceId: other.referenceId, sessionId: 'cs_test_2' })).rejects.toThrow();
    expect((await store.read(other.referenceId, other.salonId)).revision).toBe(1);
  });

  it('persists snapshots, pending sessions and verified settlement across reopen', async () => {
    const { store, directory } = await fixture();
    await store.prepare(input);

    expect((await store.bind(input.referenceId, input.salonId, 0, session)).phase).toBe('checkout_open');

    await store.observe(input.salonId, 1, evidence);
    await store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = await openCustomerPaymentRehearsalStore(directory, runtime);
    stores.push(reopened);
    const paid = await reopened.read(input.referenceId, input.salonId);

    expect(paid.phase).toBe('paid');
    expect(paid.snapshot.tipCents).toBe(2000);
    expect(await reopened.observe(input.salonId, 0, evidence)).toEqual(paid);
    expect(await reopened.observe(input.salonId, 0, { ...evidence, observedAt: 5000 })).toEqual(paid);
    await expect(reopened.prepare({ ...input, referenceId: 'attempt2' })).rejects.toThrow();
    await expect(reopened.read(input.referenceId, 'otherSalon')).rejects.toThrow('NOT_FOUND');
  });

  it('rolls back rejected receipts and serializes competing revisions', async () => {
    const { store } = await fixture();
    await store.prepare(input);
    await store.bind(input.referenceId, input.salonId, 0, session);
    const results = await Promise.allSettled([
      store.observe(input.salonId, 1, evidence),
      store.observe(input.salonId, 1, { ...evidence, eventId: 'evt_2' }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await store.read(input.referenceId, input.salonId)).revision).toBe(2);

    await store.observe(input.salonId, 2, { ...evidence, eventId: 'evt_2' });

    await expect(store.observe(input.salonId, 3, { ...evidence, amountCents: 1 })).rejects.toThrow('RECEIPT_CONFLICT');
    expect((await store.read(input.referenceId, input.salonId)).snapshot.chargeCents).toBe(13300);
  });

  it('preserves late-payment recovery and partial/full refund receipts', async () => {
    const { store } = await fixture();
    await store.prepare(input);
    await store.bind(input.referenceId, input.salonId, 0, session);
    const late = await store.observe(input.salonId, 1, { ...evidence, observedAt: 3000 });

    expect(late.phase).toBe('refund_required');

    const refund = { id: 're_1', amountCents: 3300, paymentIntentId: 'pi_1', stripeAccountId: input.stripeAccountId, livemode: false };
    const partial = await store.refund(input.referenceId, input.salonId, 2, refund);

    expect(partial.refundedCents).toBe(3300);
    expect(await store.refund(input.referenceId, input.salonId, 0, refund)).toEqual(partial);

    const full = await store.refund(input.referenceId, input.salonId, 3, { ...refund, id: 're_2', amountCents: 10000 });

    expect(full.refundedCents).toBe(13300);
    expect(full.applicationFeeRefundedCents).toBe(0);
    await expect(store.refund(input.referenceId, input.salonId, 4, { ...refund, id: 're_3' })).rejects.toThrow();
  });
});

describe('durable independent application-fee refunds', () => {
  it('persists confirmed fees across reopen, rolls back premature receipts and deduplicates concurrent retries', async () => {
    const { store, directory } = await fixture();
    await store.prepare(input);
    await store.bind(input.referenceId, input.salonId, 0, session);
    await store.observe(input.salonId, 1, evidence);
    const fee = { id: 'fee_1', paymentIntentId: 'pi_1', stripeAccountId: input.stripeAccountId, livemode: false, currency: 'cad', amountCents: 100 };
    await store.bindApplicationFee(input.referenceId, input.salonId, 2, fee);
    const refund = { id: 'fr_1', applicationFeeId: fee.id, stripeAccountId: input.stripeAccountId, livemode: false, currency: 'cad', amountCents: 100 };

    await expect(store.feeRefund(input.referenceId, input.salonId, 3, refund)).rejects.toThrow('EXCEEDS_TARGET');

    await store.refund(input.referenceId, input.salonId, 3, { id: 're_1', amountCents: 13300, paymentIntentId: 'pi_1', stripeAccountId: input.stripeAccountId, livemode: false });
    const [first, replay] = await Promise.all([
      store.feeRefund(input.referenceId, input.salonId, 4, refund),
      store.feeRefund(input.referenceId, input.salonId, 4, refund),
    ]);

    expect(first).toEqual(replay);
    expect(first.applicationFeeRefundedCents).toBe(100);
    expect(first.refundedCents).toBe(13300);
    expect(first.settledCents).toBe(13300);
    expect(first.revision).toBe(5);
    await expect(store.feeRefund(input.referenceId, input.salonId, 5, { ...refund, amountCents: 50 })).rejects.toThrow('RECEIPT_CONFLICT');

    await store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = await openCustomerPaymentRehearsalStore(directory, runtime);
    stores.push(reopened);

    expect(await reopened.feeRefund(input.referenceId, input.salonId, 0, refund)).toEqual(first);
    expect((await reopened.read(input.referenceId, input.salonId)).applicationFeeRefunds).toEqual({ fr_1: 100 });
  });
});
