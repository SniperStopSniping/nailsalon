import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import type { Salon } from '@/models/Schema';

import { getPageAppearance, type PageAppearanceResult } from './pageAppearance';
import { getSalonBySlug } from './queries';
import {
  ACTIVE_SALON_COOKIE,
  getSalonSlugFromRouteParams,
  getSalonSlugFromSearchParams,
  type RouteParamsRecord,
  type SearchParamsLike,
  normalizeSalonSlug,
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
