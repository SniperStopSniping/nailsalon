import 'server-only';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import type { Salon } from '@/models/Schema';

import { getPageAppearance, type PageAppearanceResult } from './pageAppearance';
import { getSalonBySlug } from './queries';
import {
  ACTIVE_SALON_COOKIE,
  getSalonSlugFromRouteParams,
  getSalonSlugFromSearchParams,
  normalizeSalonSlug,
  type RouteParamsRecord,
  type SearchParamsLike,
} from './tenantSlug';

export async function getActiveSalonSlugFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  return normalizeSalonSlug(cookieStore.get(ACTIVE_SALON_COOKIE)?.value);
}

export async function resolveSalonSlug(
  searchParams?: SearchParamsLike,
  params?: RouteParamsRecord | null,
): Promise<string | null> {
  return getSalonSlugFromRouteParams(params ?? undefined)
    ?? getSalonSlugFromSearchParams(searchParams)
    ?? await getActiveSalonSlugFromCookies();
}

export async function getResolvedSalon(
  searchParams?: SearchParamsLike,
  params?: RouteParamsRecord | null,
): Promise<Salon | null> {
  const salonSlug = await resolveSalonSlug(searchParams, params);
  if (!salonSlug) {
    return null;
  }

  return getSalonBySlug(salonSlug);
}

export async function requireResolvedSalon(
  searchParams?: SearchParamsLike,
  params?: RouteParamsRecord | null,
): Promise<Salon> {
  const salon = await getResolvedSalon(searchParams, params);

  if (!salon) {
    redirect('/not-found');
  }

  return salon;
}

export async function getSalonFromSlugOrCookie(
  salonSlug?: string | null,
): Promise<Salon | null> {
  const resolvedSlug = normalizeSalonSlug(salonSlug)
    ?? await getActiveSalonSlugFromCookies();

  if (!resolvedSlug) {
    return null;
  }

  return getSalonBySlug(resolvedSlug);
}

export async function requireSalonFromSlugOrCookie(
  salonSlug?: string | null,
): Promise<Salon> {
  const salon = await getSalonFromSlugOrCookie(salonSlug);

  if (!salon) {
    redirect('/not-found');
  }

  return salon;
}

export async function getPublicPageContext(
  pageName: string,
  searchParams?: SearchParamsLike,
  params?: RouteParamsRecord | null,
): Promise<{ salon: Salon; appearance: PageAppearanceResult }> {
  const salon = await requireResolvedSalon(searchParams, params);
  const appearance = await getPageAppearance(salon.id, pageName);

  return { salon, appearance };
}

/**
 * S3 (Stage 1) — publication guard for ANONYMOUS salon-by-slug routes.
 *
 * `[locale]/[slug]/layout.tsx` only 404s a DRAFT salon when `freeSoloEnabled`
 * is true (`ownerPreview.ts` — `isDraftSalon` requires both flags), and the
 * `checkSalonStatus` publication gate is called by the four booking-step pages
 * only. Every other route under the tenant slug therefore returned HTTP 200 for
 * an unpublished salon.
 *
 * This guard closes that for the anonymous routes. It deliberately calls
 * `notFound()` — the SAME outcome the layout already produces for a slug that
 * resolves to nothing — so "unpublished" and "does not exist" are
 * indistinguishable to an anonymous visitor and no existence oracle is created.
 *
 * Deliberately NOT used by:
 *   - the four booking-step pages, which already gate through `checkSalonStatus`
 *     with `allowUnpublishedPreview` threading. That threading is untouched.
 *   - capability-token routes (`manage/[token]`, …). A client holding a valid
 *     appointment capability must not be stranded because the salon was later
 *     unpublished.
 *   - `deposit/return` and `deposit/cancel`, Stripe re-entry targets that expose
 *     no salon data. See the exemption note on those pages.
 *
 * `ownerPreview.ts` draft classification and `salonStatus.ts` are NOT modified.
 */
export async function requirePublishedTenantSalon(
  salonSlug?: string | null,
): Promise<Salon> {
  const salon = await getSalonFromSlugOrCookie(salonSlug);

  if (!salon || salon.publicationStatus !== 'published') {
    notFound();
  }

  return salon;
}
