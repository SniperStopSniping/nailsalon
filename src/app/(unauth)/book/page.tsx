import { redirect } from 'next/navigation';

import { type BookingStep, getFirstStep } from '@/libs/bookingFlow';
import { getSalonBySlug } from '@/libs/queries';

export const dynamic = 'force-dynamic';

// Demo salon slug - in production, this would come from auth context or subdomain
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

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
export default async function BookEntryPage() {
  // Fetch salon data to get the booking flow
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);

  if (!salon) {
    redirect('/not-found');
  }

  // Get the first step in the booking flow
  const firstStep = getFirstStep(salon.bookingFlow as BookingStep[] | null);

  // Redirect to the first step
  redirect(`/book/${firstStep}`);
}
