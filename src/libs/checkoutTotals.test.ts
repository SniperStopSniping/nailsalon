import { describe, expect, it } from 'vitest';

import {
  buildPaymentReference,
  computeBalance,
  computeCheckoutTotals,
  derivePaymentStatus,
  type ResolvedTaxConfig,
} from './checkoutTotals';

const TAX_OFF: ResolvedTaxConfig = {
  enabled: false,
  name: null,
  rateBps: 0,
  pricesIncludeTax: false,
  taxServicesByDefault: true,
  taxAddOnsByDefault: true,
  taxCustomByDefault: true,
};

const HST_ADDED: ResolvedTaxConfig = {
  ...TAX_OFF,
  enabled: true,
  name: 'HST',
  rateBps: 1300,
};

const HST_INCLUDED: ResolvedTaxConfig = {
  ...HST_ADDED,
  pricesIncludeTax: true,
};

function taxable(lineTotalCents: number) {
  return { lineTotalCents, taxable: true };
}

function nonTaxable(lineTotalCents: number) {
  return { lineTotalCents, taxable: false };
}

describe('computeCheckoutTotals', () => {
  it('sums services, add-ons, and custom items with tax off', () => {
    const totals = computeCheckoutTotals({
      items: [taxable(4500), taxable(1500), taxable(2000)],
      taxConfig: TAX_OFF,
    });

    expect(totals.finalSubtotalCents).toBe(8000);
    expect(totals.taxAmountCents).toBe(0);
    expect(totals.taxableSubtotalCents).toBe(0);
    expect(totals.taxApplied).toBe(false);
    expect(totals.finalPriceCents).toBe(8000);
    expect(totals.totalDueCents).toBe(8000);
  });

  it('applies a flat discount before tax', () => {
    const totals = computeCheckoutTotals({
      items: [taxable(10000)],
      discountCents: 1000,
      taxConfig: HST_ADDED,
    });

    expect(totals.finalDiscountCents).toBe(1000);
    expect(totals.taxableSubtotalCents).toBe(9000);
    expect(totals.taxAmountCents).toBe(1170); // 9000 * 13%
    expect(totals.finalPriceCents).toBe(9000);
    expect(totals.totalDueCents).toBe(10170);
  });

  it('clamps the discount to the subtotal', () => {
    const totals = computeCheckoutTotals({
      items: [taxable(2000)],
      discountCents: 5000,
      taxConfig: HST_ADDED,
    });

    expect(totals.finalDiscountCents).toBe(2000);
    expect(totals.finalPriceCents).toBe(0);
    expect(totals.taxAmountCents).toBe(0);
    expect(totals.totalDueCents).toBe(0);
  });

  it('adds tax at checkout on the taxable subtotal only', () => {
    const totals = computeCheckoutTotals({
      items: [taxable(10000), nonTaxable(3000)],
      taxConfig: HST_ADDED,
    });

    expect(totals.taxableSubtotalCents).toBe(10000);
    expect(totals.taxAmountCents).toBe(1300);
    expect(totals.finalPriceCents).toBe(13000);
    expect(totals.totalDueCents).toBe(14300);
  });

  it('prorates a discount across taxable and non-taxable items', () => {
    // 10000 taxable + 5000 non-taxable, 1500 discount → 1000 hits taxable pool.
    const totals = computeCheckoutTotals({
      items: [taxable(10000), nonTaxable(5000)],
      discountCents: 1500,
      taxConfig: HST_ADDED,
    });

    expect(totals.taxableSubtotalCents).toBe(9000);
    expect(totals.taxAmountCents).toBe(1170);
    expect(totals.finalPriceCents).toBe(13500);
    expect(totals.totalDueCents).toBe(14670);
  });

  it('assigns the leftover proration cent deterministically (largest remainder)', () => {
    // 3 discount over 100 taxable + 101 non-taxable: exact taxable share is
    // 3*100/201 = 1.49… → floor 1, remainder below half → taxable gets 1.
    const totals = computeCheckoutTotals({
      items: [taxable(100), nonTaxable(101)],
      discountCents: 3,
      taxConfig: HST_ADDED,
    });

    expect(totals.taxableSubtotalCents).toBe(99);
  });

  it('decomposes included tax out of displayed prices (11300 @ 13% → 1300 tax / 10000 net)', () => {
    const totals = computeCheckoutTotals({
      items: [taxable(11300)],
      taxConfig: HST_INCLUDED,
    });

    expect(totals.finalSubtotalCents).toBe(11300);
    expect(totals.taxableSubtotalCents).toBe(11300);
    expect(totals.taxAmountCents).toBe(1300);
    expect(totals.finalPriceCents).toBe(10000);
    // Client pays exactly the displayed price.
    expect(totals.totalDueCents).toBe(11300);
  });

  it('tax-exempt zeroes tax in inclusive mode without changing what the client pays', () => {
    const totals = computeCheckoutTotals({
      items: [taxable(11300)],
      taxConfig: HST_INCLUDED,
      taxExempt: true,
    });

    expect(totals.taxApplied).toBe(false);
    expect(totals.taxAmountCents).toBe(0);
    expect(totals.finalPriceCents).toBe(11300);
    expect(totals.totalDueCents).toBe(11300);
  });

  it('never taxes the tip', () => {
    const totals = computeCheckoutTotals({
      items: [taxable(10000)],
      tipCents: 2000,
      taxConfig: HST_ADDED,
    });

    expect(totals.taxAmountCents).toBe(1300);
    expect(totals.totalDueCents).toBe(10000 + 1300 + 2000);
  });

  it('handles a 100% discount as zero-due', () => {
    const totals = computeCheckoutTotals({
      items: [taxable(5000)],
      discountCents: 5000,
      taxConfig: HST_ADDED,
    });

    expect(totals.totalDueCents).toBe(0);
    expect(derivePaymentStatus(totals.totalDueCents, 0)).toBe('paid');
  });

  it('rounds tax half-up at cent boundaries', () => {
    // 5% of 50 = 2.5 → 3; 5% of 49 = 2.45 → 2; 5% of 30 = 1.5 → 2.
    const fivePercent: ResolvedTaxConfig = { ...HST_ADDED, rateBps: 500 };
    for (const [base, expected] of [[50, 3], [49, 2], [30, 2], [10, 1], [9, 0]] as const) {
      const totals = computeCheckoutTotals({
        items: [taxable(base)],
        taxConfig: fivePercent,
      });

      expect(totals.taxAmountCents, `5% of ${base}`).toBe(expected);
    }
  });

  it('property: totalDue = finalPrice + tax + tip across both modes', () => {
    // Deterministic pseudo-random inputs (no Math.random — reproducible).
    let seed = 424242;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };

    for (let i = 0; i < 500; i++) {
      const items = Array.from({ length: 1 + next(5) }, () => ({
        lineTotalCents: next(200000),
        taxable: next(2) === 0,
      }));
      const config: ResolvedTaxConfig = {
        ...HST_ADDED,
        rateBps: next(3000),
        pricesIncludeTax: next(2) === 0,
      };
      const totals = computeCheckoutTotals({
        items,
        discountCents: next(50000),
        tipCents: next(10000),
        taxConfig: config,
      });

      expect(totals.totalDueCents).toBe(
        totals.finalPriceCents + totals.taxAmountCents + totals.tipCents,
      );
      expect(totals.finalPriceCents).toBeGreaterThanOrEqual(0);
      expect(totals.taxAmountCents).toBeGreaterThanOrEqual(0);

      // In added mode the client pays subtotal - discount + tax + tip;
      // in inclusive mode exactly subtotal - discount + tip.
      const displayedDue = totals.finalSubtotalCents - totals.finalDiscountCents + totals.tipCents;
      if (config.pricesIncludeTax) {
        expect(totals.totalDueCents).toBe(displayedDue);
      } else {
        expect(totals.totalDueCents).toBe(displayedDue + totals.taxAmountCents);
      }
    }
  });
});

describe('computeBalance', () => {
  it('treats NULL snapshots as zero (legacy rows)', () => {
    const balance = computeBalance({
      finalPriceCents: null,
      taxAmountCents: null,
      tipCents: null,
      amountPaidCents: null,
    });

    expect(balance.totalDueCents).toBe(0);
    expect(balance.balanceCents).toBe(0);
  });

  it('computes an outstanding balance after a partial payment', () => {
    const balance = computeBalance({
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 1000,
      amountPaidCents: 5000,
    });

    expect(balance.totalDueCents).toBe(12300);
    expect(balance.balanceCents).toBe(7300);
  });

  it('complimentary appointments owe nothing', () => {
    const balance = computeBalance({
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 0,
      amountPaidCents: 0,
      paymentStatus: 'comp',
    });

    expect(balance.balanceCents).toBe(0);
  });
});

describe('derivePaymentStatus', () => {
  it('maps amounts to pending / partially_paid / paid', () => {
    expect(derivePaymentStatus(10000, 0)).toBe('pending');
    expect(derivePaymentStatus(10000, 4000)).toBe('partially_paid');
    expect(derivePaymentStatus(10000, 10000)).toBe('paid');
    expect(derivePaymentStatus(10000, 12000)).toBe('paid');
  });
});

describe('buildPaymentReference', () => {
  it('derives a stable, PII-free reference from the appointment id', () => {
    expect(buildPaymentReference('appt_abc123XYZ789')).toBe('LSTR-XYZ789');
    expect(buildPaymentReference('appt_abc123XYZ789')).toBe(buildPaymentReference('appt_abc123XYZ789'));
    expect(buildPaymentReference('')).toBe('LSTR-APPT');
  });
});
