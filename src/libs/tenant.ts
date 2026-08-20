import 'server-only';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import type { Salon } from '@/models/Schema';

import { resolveDraftSalonAccess } from './ownerPreview';
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
 * S3 (Stage 1) — publication guard for salon-by-slug routes that had none.
 *
 * `[locale]/[slug]/layout.tsx` only 404s a DRAFT salon when `freeSoloEnabled`
 * is true (`ownerPreview.ts` — `isDraftSalon` requires both flags), and the
 * `checkSalonStatus` publication gate is called by the four booking-step pages
 * only. Every other route under the tenant slug therefore returned HTTP 200 for
 * an unpublished salon.
 *
 * OWNER PREVIEW IS PRESERVED. This does NOT decide publication on its own: it
 * reuses `resolveDraftSalonAccess` — the repository's single authorization
 * matrix — exactly as the booking-step pages thread `allowUnpublishedPreview`.
 * An authorized owner (or impersonating super admin) previewing their own draft
 * salon still reaches these routes; only unauthorized traffic is refused. An
 * earlier revision of this guard checked `publicationStatus` directly and would
 * have 404'd the owner on the very status pages `checkSalonStatus` redirects an
 * authorized previewer to.
 *
 * It calls `notFound()` — the SAME control-flow outcome the layout already
 * produces for a slug that resolves to nothing — so an unauthorized visitor is
 * not handed a rendered page for an unpublished salon. Precisely: the two cases
 * are indistinguishable in STATUS and in rendered page content. Byte-level
 * equality of the 404 RSC payload is NOT claimed here — the nonexistent case
 * 404s from the layout and the unpublished case from the page, and that
 * comparison has not been captured at the response level.
 *
 * Takes a REQUIRED slug and resolves with `getSalonBySlug` directly, never
 * `getSalonFromSlugOrCookie`: a guard that answers "does THIS URL's salon
 * publish" must not fall back to an ambient `__active_salon_slug` cookie that
 * could authorize a different salon than the URL names.
 *
 * Deliberately NOT used by:
 *   - the four booking-step pages, which already gate through `checkSalonStatus`.
 *     That threading is untouched.
 *   - capability-token routes (`manage/[token]`, …). A client holding a valid
 *     appointment capability must not be stranded because the salon was later
 *     unpublished.
 *   - `deposit/return` and `deposit/cancel`, Stripe re-entry targets that expose
 *     no salon data. See the exemption note on those pages.
 *
 * `ownerPreview.ts` and `salonStatus.ts` are NOT modified.
 */
export async function requirePublishedTenantSalon(
  salonSlug: string,
): Promise<Salon> {
  const salon = await getSalonBySlug(salonSlug);

  if (!salon) {
    notFound();
  }

  if (salon.publicationStatus === 'published') {
    return salon;
  }

  // Unpublished: defer to the same authorization matrix every other
  // publication decision in the tree uses, rather than deciding here.
  const gate = await resolveDraftSalonAccess({
    id: salon.id,
    publicationStatus: salon.publicationStatus,
    freeSoloEnabled: salon.freeSoloEnabled,
  });

  if (!gate.allowed || !gate.isPreviewingDraftSalon) {
    notFound();
  }

  return salon;
}
