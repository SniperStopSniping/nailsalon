import { eq, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  salonLocationSchema,
  type SalonPlan,
  salonSchema,
  technicianSchema,
} from '@/models/Schema';

import type { FeatureTier } from './featureTiers';

// =============================================================================
// Plan to Feature Tier Mapping
// =============================================================================

/**
 * Maps billing plans to feature tiers.
 * This bridges the plan system (limits) with the feature tier system (entitlements).
 *
 * - free → starter (basic features only)
 * - single_salon → pro (marketing + client management)
 * - multi_salon → elite (all features)
 * - enterprise → elite (all features, unlimited limits)
 */
export const PLAN_TO_FEATURE_TIER: Record<SalonPlan, FeatureTier> = {
  free: 'starter',
  single_salon: 'pro',
  multi_salon: 'elite',
  enterprise: 'elite',
} as const;

// =============================================================================
// Plan Limits Configuration
// =============================================================================

export type PlanLimits = {
  maxTechs: number; // -1 = unlimited
  maxLocations: number; // -1 = unlimited
  features: string[];
};

export const PLAN_LIMITS: Record<SalonPlan, PlanLimits> = {
  free: {
    maxTechs: 1,
    maxLocations: 1,
    features: [],
  },
  single_salon: {
    maxTechs: 10,
    maxLocations: 1,
    features: ['analytics', 'rewards'],
  },
  multi_salon: {
    maxTechs: 50,
    maxLocations: 10,
    features: ['analytics', 'rewards', 'multi_location', 'advanced_reports'],
  },
  enterprise: {
    maxTechs: -1, // unlimited
    maxLocations: -1, // unlimited
    features: ['all'],
  },
};

// =============================================================================
// Plan Limit Helpers
// =============================================================================

/**
 * Get the plan limits for a salon
 */
export function getPlanLimits(plan: SalonPlan): PlanLimits {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

/**
 * Check if a salon has access to a specific feature
 */
export function hasFeature(plan: SalonPlan, feature: string): boolean {
  const limits = getPlanLimits(plan);
  return limits.features.includes('all') || limits.features.includes(feature);
}

/**
 * Check if a salon can add more technicians
 */
export async function canAddTechnician(salonId: string): Promise<{
  allowed: boolean;
  current: number;
  max: number;
  plan: SalonPlan;
}> {
  // Get salon
  const [salon] = await db
    .select({ plan: salonSchema.plan })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return { allowed: false, current: 0, max: 0, plan: 'free' };
  }

  const plan = (salon.plan || 'free') as SalonPlan;
  const limits = getPlanLimits(plan);

  // If unlimited, always allow
  if (limits.maxTechs === -1) {
    return { allowed: true, current: 0, max: -1, plan };
  }

  // Count current active technicians
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(technicianSchema)
    .where(eq(technicianSchema.salonId, salonId));

  const current = Number(countResult?.count ?? 0);
  const allowed = current < limits.maxTechs;

  return { allowed, current, max: limits.maxTechs, plan };
}

/**
 * Check if a salon can add more locations
 */
export async function canAddLocation(salonId: string): Promise<{
  allowed: boolean;
  current: number;
  max: number;
  plan: SalonPlan;
}> {
  // Get salon with maxLocations override
  const [salon] = await db
    .select({
      plan: salonSchema.plan,
      maxLocations: salonSchema.maxLocations,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return { allowed: false, current: 0, max: 0, plan: 'free' };
  }

  const plan = (salon.plan || 'free') as SalonPlan;
  const limits = getPlanLimits(plan);

  // Use salon's maxLocations if set, otherwise use plan default
  const maxLocations = salon.maxLocations ?? limits.maxLocations;

  // If unlimited, always allow
  if (maxLocations === -1) {
    return { allowed: true, current: 0, max: -1, plan };
  }

  // Count current locations
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(salonLocationSchema)
    .where(eq(salonLocationSchema.salonId, salonId));

  const current = Number(countResult?.count ?? 0);
  const allowed = current < maxLocations;

  return { allowed, current, max: maxLocations, plan };
}

/**
 * Get full plan status for a salon
 */
export async function getSalonPlanStatus(salonId: string): Promise<{
  plan: SalonPlan;
  limits: PlanLimits;
  usage: {
    technicians: { current: number; max: number; remaining: number };
    locations: { current: number; max: number; remaining: number };
  };
  features: string[];
}> {
  // Get salon
  const [salon] = await db
    .select({
      plan: salonSchema.plan,
      maxLocations: salonSchema.maxLocations,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return {
      plan: 'free',
      limits: PLAN_LIMITS.free,
      usage: {
        technicians: { current: 0, max: 1, remaining: 1 },
        locations: { current: 0, max: 1, remaining: 1 },
      },
      features: [],
    };
  }

  const plan = (salon.plan || 'free') as SalonPlan;
  const limits = getPlanLimits(plan);

  // Count technicians
  const [techCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(technicianSchema)
    .where(eq(technicianSchema.salonId, salonId));

  // Count locations
  const [locCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(salonLocationSchema)
    .where(eq(salonLocationSchema.salonId, salonId));

  const currentTechs = Number(techCount?.count ?? 0);
  const currentLocs = Number(locCount?.count ?? 0);
  const maxLocs = salon.maxLocations ?? limits.maxLocations;

  return {
    plan,
    limits,
    usage: {
      technicians: {
        current: currentTechs,
        max: limits.maxTechs,
        remaining: limits.maxTechs === -1 ? -1 : Math.max(0, limits.maxTechs - currentTechs),
      },
      locations: {
        current: currentLocs,
        max: maxLocs,
        remaining: maxLocs === -1 ? -1 : Math.max(0, maxLocs - currentLocs),
      },
    },
    features: limits.features,
  };
}

// =============================================================================
// Plan Enforcement Error
// =============================================================================

export class PlanLimitError extends Error {
  constructor(
    public limitType: 'technicians' | 'locations' | 'feature',
    public current: number,
    public max: number,
    public plan: SalonPlan,
  ) {
    super(`Plan limit reached: ${limitType} (${current}/${max}) on ${plan} plan`);
    this.name = 'PlanLimitError';
  }
}

/**
 * Enforce technician limit - throws if limit exceeded
 */
export async function enforceTechnicianLimit(salonId: string): Promise<void> {
  const result = await canAddTechnician(salonId);
  if (!result.allowed) {
    throw new PlanLimitError('technicians', result.current, result.max, result.plan);
  }
}

/**
 * Enforce location limit - throws if limit exceeded
 */
export async function enforceLocationLimit(salonId: string): Promise<void> {
  const result = await canAddLocation(salonId);
  if (!result.allowed) {
    throw new PlanLimitError('locations', result.current, result.max, result.plan);
  }
}
