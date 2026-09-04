import { CalendarX } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';
import { resolvePublicSalonStatusIdentity } from '@/libs/salonContent';
import { requirePublishedTenantSalon } from '@/libs/tenant';

export const metadata = {
  title: 'Online Booking Unavailable',
  description: 'Online booking is not currently available for this salon.',
};

/**
 * Tenant-scoped variant of `(unauth)/booking-disabled`.
 *
 * S3 (Stage 1): previously a one-line re-export with NO gate, so an unpublished
 * salon rendered it at HTTP 200 while an unresolvable slug 404'd — an existence
 * oracle at a salon-specific URL. `requirePublishedTenantSalon` makes the two
 * indistinguishable.
 *
 * S6b (Stage 1): this destination is reached only after the publication check
 * has already passed (`checkSalonStatus` evaluates publication BEFORE status),
 * so the salon's existence is already disclosed here and naming it adds no new
 * disclosure. Only the narrow `resolvePublicSalonStatusIdentity` projection is
 * passed — name plus city/state, never address, postal code, phone or email.
 */
export default async function TenantBookingDisabledPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const salon = await requirePublishedTenantSalon(params.slug);

  return (
    <SalonStatusPage
      icon={CalendarX}
      title="Online Booking Unavailable"
      description="This salon is not currently accepting online bookings. Please contact the salon directly to schedule your appointment."
      footer="Online booking may be temporarily unavailable or not offered by this salon."
      salonIdentity={resolvePublicSalonStatusIdentity({
        name: salon.name,
        city: salon.city,
        state: salon.state,
      })}
    />
  );
}
