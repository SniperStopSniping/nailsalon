import { AlertTriangle } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';
import { resolvePublicSalonStatusIdentity } from '@/libs/salonContent';
import { requirePublishedTenantSalon } from '@/libs/tenant';

export const metadata = {
  title: 'Account Suspended',
  description: 'This salon account has been temporarily suspended.',
};

/**
 * Tenant-scoped variant of `(unauth)/suspended`.
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
export default async function TenantSuspendedPage({ params }: { params: { slug: string } }) {
  const salon = await requirePublishedTenantSalon(params.slug);

  return (
    <SalonStatusPage
      icon={AlertTriangle}
      title="Account Temporarily Suspended"
      description="This salon's booking system is currently unavailable. This may be due to maintenance or an account issue. We apologize for any inconvenience — please contact the salon directly to book."
      footer="If you are the salon owner, please contact support to restore access."
      salonIdentity={resolvePublicSalonStatusIdentity({
        name: salon.name,
        city: salon.city,
        state: salon.state,
      })}
    />
  );
}
