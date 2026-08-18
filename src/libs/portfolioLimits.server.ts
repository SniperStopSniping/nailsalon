import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  type PortfolioAllowance,
  portfolioLimitForPlan,
  resolvePortfolioAllowance,
  UNLIMITED_PORTFOLIO_PHOTOS,
} from '@/libs/portfolioLimits';
import { type SalonPlan, salonPortfolioPhotoSchema, salonSchema } from '@/models/Schema';

/**
 * Database-backed half of the Portfolio photo limit.
 *
 * The vocabulary (the plan mapping, allowance resolution, the typed error)
 * lives in `@/libs/portfolioLimits` with no server-only import, so the owner
 * admin UI can render usage and limit states without pulling server code into
 * a client bundle. Only the parts that actually touch the database live here.
 */

export async function getPortfolioAllowance(salonId: string): Promise<PortfolioAllowance> {
  const [salon] = await db
    .select({
      plan: salonSchema.plan,
      maxPortfolioPhotos: salonSchema.maxPortfolioPhotos,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    // Fail closed: an unknown salon gets the smallest allowance, never a
    // permissive default.
    return { plan: 'free', max: portfolioLimitForPlan('free'), source: 'plan' };
  }

  return resolvePortfolioAllowance({
    plan: salon.plan as SalonPlan | null,
    maxPortfolioPhotos: salon.maxPortfolioPhotos,
  });
}

/** Count of stored (non-deleted) photos — the value the limit applies to. */
export async function countStoredPortfolioPhotos(salonId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(salonPortfolioPhotoSchema)
    .where(
      and(
        eq(salonPortfolioPhotoSchema.salonId, salonId),
        isNull(salonPortfolioPhotoSchema.deletedAt),
      ),
    );

  return Number(row?.count ?? 0);
}

export type PortfolioUsage = PortfolioAllowance & {
  stored: number;
  remaining: number;
  /** Stored exceeds the allowance — uploads are blocked until it does not. */
  overAllowance: boolean;
};

export async function getPortfolioUsage(salonId: string): Promise<PortfolioUsage> {
  const [allowance, stored] = await Promise.all([
    getPortfolioAllowance(salonId),
    countStoredPortfolioPhotos(salonId),
  ]);

  const unlimited = allowance.max === UNLIMITED_PORTFOLIO_PHOTOS;

  return {
    ...allowance,
    stored,
    remaining: unlimited ? UNLIMITED_PORTFOLIO_PHOTOS : Math.max(0, allowance.max - stored),
    overAllowance: !unlimited && stored > allowance.max,
  };
}
