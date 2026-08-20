import { XCircle } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';
import { resolvePublicSalonStatusIdentity } from '@/libs/salonContent';
import { requirePublishedTenantSalon } from '@/libs/tenant';

export const metadata = {
  title: 'Account Cancelled',
  description: 'This salon account has been cancelled.',
};

/**
 * Tenant-scoped variant of `(unauth)/cancelled`.
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
export default async function TenantCancelledPage({ params }: { params: { slug: string } }) {
  const salon = await requirePublishedTenantSalon(params.slug);

  return (
    <SalonStatusPage
      icon={XCircle}
      title="Account No Longer Active"
      description="This salon's booking system is no longer available. The salon may have moved to a different platform — please contact them directly to book your next appointment."
      footer="If you are the salon owner, please contact support for more information."
      salonIdentity={resolvePublicSalonStatusIdentity({
        name: salon.name,
        city: salon.city,
        state: salon.state,
      })}
    />
  );
}
