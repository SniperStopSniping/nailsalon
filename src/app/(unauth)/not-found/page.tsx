import { Search } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';

export const metadata = {
  title: 'Salon Not Found',
  description: 'We could not find the salon you were looking for.',
};

/**
 * Salon Not Found Page
 *
 * Shown when a booking link has no resolvable salon (unknown slug, missing
 * cookie, or expired link). This route must exist: tenant resolution
 * redirects here, and without a real page the redirect loops forever.
 */
export default function SalonNotFoundPage() {
  return (
    <SalonStatusPage
      icon={Search}
      title="Salon Not Found"
      description="We couldn't find the salon you were looking for. The booking link may be incomplete or out of date. Please use the booking link your salon shared with you — for example from their website, Instagram bio, or a text message."
    />
  );
}
