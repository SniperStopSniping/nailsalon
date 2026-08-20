import { requirePublishedTenantSalon } from '@/libs/tenant';

import RewardsDisabledPage from '../../../(unauth)/rewards-disabled/page';

/**
 * Tenant-scoped variant of `(unauth)/rewards-disabled`.
 *
 * S3 (Stage 1): gated for consistency with its sibling status routes — an
 * unpublished salon must not render 200 at a salon-specific URL while an
 * unresolvable slug 404s.
 *
 * S6b (Stage 1): deliberately NO salon identity here. This destination is
 * currently UNREACHABLE in production: its only producer is the `rewards` /
 * `referrals` branch of the deprecated `checkFeatureEnabled` redirect map, and
 * every non-test caller passes `onlineBooking`. Adding identity would be
 * unverifiable user-facing work on dead code, so the route is gated for safety
 * and its dead status is recorded in the defect register instead.
 */
export default async function TenantRewardsDisabledPage({
  params,
  searchParams,
}: {
  params: { locale?: string; slug: string };
  searchParams: { salonSlug?: string };
}) {
  await requirePublishedTenantSalon(params.slug);

  return RewardsDisabledPage({ params, searchParams });
}
