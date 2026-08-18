import { describe, expect, it } from 'vitest';

import {
  FOUNDING_PORTFOLIO_PHOTO_LIMIT,
  PORTFOLIO_PHOTO_LIMITS,
  PortfolioLimitError,
  portfolioLimitForPlan,
  resolvePortfolioAllowance,
  UNLIMITED_PORTFOLIO_PHOTOS,
} from './portfolioLimits';

describe('portfolioLimitForPlan', () => {
  it('covers every legacy plan identifier and no others', () => {
    expect(Object.keys(PORTFOLIO_PHOTO_LIMITS).sort())
      .toEqual(['enterprise', 'free', 'multi_salon', 'single_salon']);
  });

  it('maps each legacy identifier to its owner-ratified allowance', () => {
    expect(portfolioLimitForPlan('free')).toBe(10);
    expect(portfolioLimitForPlan('single_salon')).toBe(75);
    expect(portfolioLimitForPlan('multi_salon')).toBe(200);
    expect(portfolioLimitForPlan('enterprise')).toBe(200);
  });

  it('gives identifiers that share a feature tier the same allowance', () => {
    // multi_salon and enterprise are two historical aliases for the elite
    // tier in PLAN_TO_FEATURE_TIER. Asserted as a property here rather than by
    // importing planLimits, which reaches the database and would drag
    // server-only into what is deliberately a client-safe module.
    expect(portfolioLimitForPlan('multi_salon')).toBe(portfolioLimitForPlan('enterprise'));
  });

  it('never grants an unlimited allowance to any plan', () => {
    // The ratified table tops out at the elite/team tier. Granting more than
    // any named row would be a silent escalation.
    for (const plan of Object.keys(PORTFOLIO_PHOTO_LIMITS) as (keyof typeof PORTFOLIO_PHOTO_LIMITS)[]) {
      expect(portfolioLimitForPlan(plan)).not.toBe(UNLIMITED_PORTFOLIO_PHOTOS);
      expect(portfolioLimitForPlan(plan)).toBeLessThanOrEqual(200);
    }
  });

  it('never decreases as the plan grows', () => {
    const free = portfolioLimitForPlan('free');
    const single = portfolioLimitForPlan('single_salon');
    const multi = portfolioLimitForPlan('multi_salon');

    expect(single).toBeGreaterThan(free);
    expect(multi).toBeGreaterThan(single);
  });
});

describe('founding salons', () => {
  it('grants the founding allowance regardless of the plan row', () => {
    const allowance = resolvePortfolioAllowance({
      plan: 'free',
      maxPortfolioPhotos: null,
      freeSoloEnabled: true,
    });

    expect(allowance.max).toBe(FOUNDING_PORTFOLIO_PHOTO_LIMIT);
    expect(allowance.max).toBe(75);
    expect(allowance.source).toBe('founding');
  });

  it('lets an explicit per-salon number override the founding default', () => {
    const allowance = resolvePortfolioAllowance({
      plan: 'free',
      maxPortfolioPhotos: 120,
      freeSoloEnabled: true,
    });

    expect(allowance.max).toBe(120);
    expect(allowance.source).toBe('override');
  });

  it('does not raise a paid plan below its own allowance', () => {
    // A founding multi_salon keeps 200; founding is a floor for entry plans,
    // never a downgrade.
    const allowance = resolvePortfolioAllowance({
      plan: 'multi_salon',
      maxPortfolioPhotos: null,
      freeSoloEnabled: true,
    });

    expect(allowance.max).toBeGreaterThanOrEqual(FOUNDING_PORTFOLIO_PHOTO_LIMIT);
  });

  it('leaves non-founding salons on their plan row', () => {
    expect(resolvePortfolioAllowance({
      plan: 'free',
      maxPortfolioPhotos: null,
      freeSoloEnabled: false,
    })).toEqual({ plan: 'free', max: 10, source: 'plan' });
  });
});

describe('resolvePortfolioAllowance', () => {
  it('uses the plan default when no override is set', () => {
    expect(resolvePortfolioAllowance({ plan: 'single_salon', maxPortfolioPhotos: null }))
      .toEqual({ plan: 'single_salon', max: 75, source: 'plan' });
    expect(resolvePortfolioAllowance({ plan: 'multi_salon', maxPortfolioPhotos: null }))
      .toEqual({ plan: 'multi_salon', max: 200, source: 'plan' });
    expect(resolvePortfolioAllowance({ plan: 'enterprise', maxPortfolioPhotos: null }))
      .toEqual({ plan: 'enterprise', max: 200, source: 'plan' });
  });

  it('lets a per-salon override win over the plan row', () => {
    expect(resolvePortfolioAllowance({ plan: 'free', maxPortfolioPhotos: 75 }))
      .toEqual({ plan: 'free', max: 75, source: 'override' });
  });

  it('honours an override that is more restrictive than the plan', () => {
    expect(resolvePortfolioAllowance({ plan: 'multi_salon', maxPortfolioPhotos: 5 }).max).toBe(5);
  });

  it('honours an unlimited override', () => {
    expect(resolvePortfolioAllowance({ plan: 'free', maxPortfolioPhotos: -1 }).max)
      .toBe(UNLIMITED_PORTFOLIO_PHOTOS);
  });

  it('honours a zero override rather than reading it as "unset"', () => {
    const allowance = resolvePortfolioAllowance({ plan: 'free', maxPortfolioPhotos: 0 });

    expect(allowance.max).toBe(0);
    expect(allowance.source).toBe('override');
  });

  it('fails closed to the free allowance for a missing or unknown plan', () => {
    expect(resolvePortfolioAllowance({ plan: null, maxPortfolioPhotos: null }))
      .toEqual({ plan: 'free', max: 10, source: 'plan' });
    expect(resolvePortfolioAllowance({ plan: 'legacy_unknown' as never, maxPortfolioPhotos: null }).max)
      .toBe(10);
  });

  it('never resolves an unknown plan to the highest allowance', () => {
    const unknown = resolvePortfolioAllowance({
      plan: 'some_retired_alias' as never,
      maxPortfolioPhotos: null,
    });

    expect(unknown.max).toBe(portfolioLimitForPlan('free'));
    expect(unknown.max).toBeLessThan(portfolioLimitForPlan('multi_salon'));
  });
});

describe('PortfolioLimitError', () => {
  it('carries the numbers an owner-facing message needs', () => {
    const error = new PortfolioLimitError({ stored: 10, max: 10, plan: 'free' });

    expect(error.code).toBe('PORTFOLIO_PHOTO_LIMIT_REACHED');
    expect(error.stored).toBe(10);
    expect(error.max).toBe(10);
    expect(error.message).toContain('10/10');
  });
});
