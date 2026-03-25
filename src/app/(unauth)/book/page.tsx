import { redirect } from 'next/navigation';

import { type BookingStep, getFirstStep } from '@/libs/bookingFlow';
import { buildBookingUrl } from '@/libs/bookingParams';
import { requireResolvedSalon } from '@/libs/tenant';

export const dynamic = 'force-dynamic';

/**
 * Canonical Booking Entry Page
 *
 * This is the permanent entry URL for all "Book Now" links.
 * External links (website buttons, QR codes, IG bio, etc.) should always point here.
 *
 * The page reads the salon's bookingFlow and redirects to the first step:
 * - Default flow: /book → /book/service
 * - Tech-first flow: /book → /book/tech
 * - Tech disabled: /book → /book/service (or /book/time if service is not first)
 *
 * This way, when a salon reorders or disables steps, external links don't need to change.
 */
export default async function BookEntryPage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  // Fetch salon data to get the booking flow
  const salon = await requireResolvedSalon(searchParams, params);

  // Get the first step in the booking flow
  const firstStep = getFirstStep(salon.bookingFlow as BookingStep[] | null);

  // Redirect to the first step
  const localePrefix = params?.locale ? `/${params.locale}` : '';

  redirect(buildBookingUrl(`${localePrefix}/book/${firstStep}`, {
    salonSlug: searchParams.salonSlug ?? salon.slug,
  }, {
    routeSalonSlug: params?.slug,
    locale: params?.locale,
  }));
}
