/**
 * R-6 coverage derivation — the single reading of "what period did this
 * invoice pay for" that the webhook and the reconcile cron both consume.
 *
 * The cases that matter are the ones the old inline min/max got wrong: a
 * renewal carrying a proration line for the PREVIOUS cycle, an invoice-item
 * line that is not subscription coverage at all, and a truncated line page
 * that must never be read as if it were the whole invoice.
 */
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const stripeMock = vi.hoisted(() => ({
  invoices: { listLineItems: vi.fn() },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));

const { loadInvoiceLines, subscriptionLinePeriods } = await import('./invoiceLinePeriods');

const JAN = 1_767_225_600; // 2026-01-01T00:00:00Z
const FEB = 1_769_904_000; // 2026-02-01T00:00:00Z
const MAR = 1_772_323_200; // 2026-03-01T00:00:00Z

function line(over: Partial<Stripe.InvoiceLineItem> & { start?: number; end?: number } = {}): Stripe.InvoiceLineItem {
  const { start, end, ...rest } = over;
  return {
    id: `il_${Math.random().toString(36).slice(2)}`,
    type: 'subscription',
    proration: false,
    subscription: null,
    period: { start: start ?? JAN, end: end ?? FEB },
    ...rest,
  } as unknown as Stripe.InvoiceLineItem;
}

beforeEach(() => {
  stripeMock.invoices.listLineItems.mockReset();
});

describe('subscriptionLinePeriods', () => {
  it('spans the non-proration subscription lines: min(start) … max(end)', () => {
    const coverage = subscriptionLinePeriods(
      [line({ start: FEB, end: MAR }), line({ start: JAN, end: FEB })],
      'sub_1',
    );

    expect(coverage).toEqual({ kind: 'ok', start: new Date(JAN * 1000), end: new Date(MAR * 1000) });
  });

  it('IGNORES a proration line from the previous cycle on a renewal invoice (R-6/RT-17)', () => {
    const coverage = subscriptionLinePeriods(
      [
        line({ start: JAN + 14 * 24 * 3600, end: FEB, proration: true }),
        line({ start: FEB, end: MAR }),
      ],
      'sub_1',
    );

    // The proration's January start must NOT drag paid coverage back into
    // the (possibly refunded) previous cycle.
    expect(coverage).toEqual({ kind: 'ok', start: new Date(FEB * 1000), end: new Date(MAR * 1000) });
  });

  it('ignores invoiceitem lines — they are not subscription coverage', () => {
    const coverage = subscriptionLinePeriods(
      [line({ type: 'invoiceitem' as Stripe.InvoiceLineItem.Type, start: JAN, end: MAR }), line({ start: FEB, end: MAR })],
      'sub_1',
    );

    expect(coverage).toEqual({ kind: 'ok', start: new Date(FEB * 1000), end: new Date(MAR * 1000) });
  });

  it('ignores a subscription line belonging to a DIFFERENT subscription', () => {
    const coverage = subscriptionLinePeriods(
      [line({ subscription: 'sub_other', start: JAN, end: MAR }), line({ subscription: 'sub_1', start: FEB, end: MAR })],
      'sub_1',
    );

    expect(coverage).toEqual({ kind: 'ok', start: new Date(FEB * 1000), end: new Date(MAR * 1000) });
  });

  it('treats a null/absent line.subscription as THIS invoice\'s subscription', () => {
    const expanded = { id: 'sub_1' } as unknown as Stripe.Subscription;

    expect(subscriptionLinePeriods([line({ subscription: null })], 'sub_1').kind).toBe('ok');
    expect(subscriptionLinePeriods([line({ subscription: expanded })], 'sub_1').kind).toBe('ok');
  });

  it('is no_subscription_lines for a proration-only invoice', () => {
    expect(subscriptionLinePeriods([line({ proration: true })], 'sub_1')).toEqual({ kind: 'no_subscription_lines' });
  });

  it('is no_subscription_lines for an empty (but readable) line set', () => {
    expect(subscriptionLinePeriods([], 'sub_1')).toEqual({ kind: 'no_subscription_lines' });
  });

  it('is no_subscription_lines when every period is non-positive', () => {
    expect(subscriptionLinePeriods([line({ start: 0, end: 0 })], 'sub_1')).toEqual({ kind: 'no_subscription_lines' });
  });

  it('is unknown — never a guess — when the line set could not be read at all', () => {
    expect(subscriptionLinePeriods(undefined, 'sub_1')).toEqual({ kind: 'unknown' });
    expect(subscriptionLinePeriods(null, 'sub_1')).toEqual({ kind: 'unknown' });
  });
});

describe('loadInvoiceLines', () => {
  it('returns the embedded page and makes NO Stripe call when has_more is false', async () => {
    const data = [line()];
    const lines = await loadInvoiceLines({ id: 'in_1', lines: { data, has_more: false } } as unknown as Stripe.Invoice);

    expect(lines).toBe(data);
    expect(stripeMock.invoices.listLineItems).not.toHaveBeenCalled();
  });

  it('pages through listLineItems only when has_more is true', async () => {
    const paged = [line({ start: JAN, end: FEB }), line({ start: FEB, end: MAR })];
    const autoPagingToArray = vi.fn(async () => paged);
    stripeMock.invoices.listLineItems.mockReturnValue({ autoPagingToArray });

    const lines = await loadInvoiceLines({
      id: 'in_truncated',
      lines: { data: [line()], has_more: true },
    } as unknown as Stripe.Invoice);

    expect(lines).toBe(paged);
    expect(stripeMock.invoices.listLineItems).toHaveBeenCalledWith('in_truncated', { limit: 100 });
    expect(autoPagingToArray).toHaveBeenCalledWith({ limit: 1000 });
  });

  // A transient Stripe failure is NOT a fact about the invoice. Swallowing
  // it into `null` (⇒ `unknown` coverage) made the caller hold the event
  // terminally — no retry, and for the payment path no operator exit either.
  // Thrown, the webhook's own catch makes it failed_retryable.
  it('PROPAGATES a synchronous paging failure instead of reporting unknown coverage', async () => {
    stripeMock.invoices.listLineItems.mockImplementation(() => {
      throw new Error('stripe is down');
    });

    await expect(loadInvoiceLines({
      id: 'in_truncated',
      lines: { data: [line()], has_more: true },
    } as unknown as Stripe.Invoice)).rejects.toThrow('stripe is down');
  });

  it('PROPAGATES an asynchronous paging rejection', async () => {
    stripeMock.invoices.listLineItems.mockReturnValue({
      autoPagingToArray: vi.fn(async () => {
        throw new Error('rate limited');
      }),
    });

    await expect(loadInvoiceLines({
      id: 'in_truncated',
      lines: { data: [line()], has_more: true },
    } as unknown as Stripe.Invoice)).rejects.toThrow('rate limited');
  });

  // `null` survives only for STRUCTURALLY unreadable input — facts about the
  // object, which no retry can change.
  it('returns null when the invoice carries no readable line set at all', async () => {
    await expect(loadInvoiceLines({ id: 'in_1' } as unknown as Stripe.Invoice)).resolves.toBeNull();
    await expect(loadInvoiceLines({ id: 'in_1', lines: {} } as unknown as Stripe.Invoice)).resolves.toBeNull();
    expect(subscriptionLinePeriods(null, 'sub_1')).toEqual({ kind: 'unknown' });
  });

  it('returns null — never pages — for a truncated page on an invoice with no id', async () => {
    await expect(loadInvoiceLines({
      lines: { data: [line()], has_more: true },
    } as unknown as Stripe.Invoice)).resolves.toBeNull();
    expect(stripeMock.invoices.listLineItems).not.toHaveBeenCalled();
  });
});
