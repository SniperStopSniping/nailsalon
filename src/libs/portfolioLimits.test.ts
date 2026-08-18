import { describe, expect, it } from 'vitest';

import {
  PORTFOLIO_PHOTO_LIMITS,
  PortfolioLimitError,
  portfolioLimitForPlan,
  resolvePortfolioAllowance,
  UNLIMITED_PORTFOLIO_PHOTOS,
} from './portfolioLimits';

describe('portfolioLimitForPlan', () => {
  it('covers every legacy plan', () => {
    expect(Object.keys(PORTFOLIO_PHOTO_LIMITS).sort())
      .toEqual(['enterprise', 'free', 'multi_salon', 'single_salon']);
  });

  it('gives the smallest allowance to the free plan', () => {
    expect(portfolioLimitForPlan('free')).toBe(10);
  });

  it('treats enterprise as unlimited, matching the other plan limits', () => {
    expect(portfolioLimitForPlan('enterprise')).toBe(UNLIMITED_PORTFOLIO_PHOTOS);
  });

  it('never decreases as the plan grows', () => {
    const free = portfolioLimitForPlan('free');
    const single = portfolioLimitForPlan('single_salon');
    const multi = portfolioLimitForPlan('multi_salon');

    expect(single).toBeGreaterThan(free);
    expect(multi).toBeGreaterThan(single);
  });
});

describe('resolvePortfolioAllowance', () => {
  it('uses the plan default when no override is set', () => {
    expect(resolvePortfolioAllowance({ plan: 'single_salon', maxPortfolioPhotos: null }))
      .toEqual({ plan: 'single_salon', max: 75, source: 'plan' });
  });

  it('lets a per-salon override win, which is how founding businesses are handled', () => {
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
