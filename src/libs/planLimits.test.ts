import { describe, expect, it, vi } from 'vitest';

import {
  getPlanLimits,
  hasFeature,
  PLAN_LIMITS,
  PLAN_TO_FEATURE_TIER,
} from './planLimits';

vi.mock('@/libs/DB', () => ({ db: {} }));

describe('universal product plan limits', () => {
  it('maps every legacy billing plan to the universal built-feature tier', () => {
    expect(PLAN_TO_FEATURE_TIER).toEqual({
      free: 'elite',
      single_salon: 'elite',
      multi_salon: 'elite',
      enterprise: 'elite',
    });
  });

  it('keeps the historical highest capacity on every plan on every plan', () => {
    for (const plan of Object.keys(PLAN_LIMITS) as Array<keyof typeof PLAN_LIMITS>) {
      expect(getPlanLimits(plan)).toMatchObject({
        maxTechs: -1,
        maxLocations: -1,
        features: ['all'],
      });
      expect(hasFeature(plan, 'any_built_feature')).toBe(true);
    }
  });
});
