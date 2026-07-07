import { XCircle } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';

export const metadata = {
  title: 'Account Cancelled',
  description: 'This salon account has been cancelled.',
};

export default function CancelledPage() {
  return (
    <SalonStatusPage
      icon={XCircle}
      title="Account No Longer Active"
      description="This salon's booking system is no longer available. The salon may have moved to a different platform — please contact them directly to book your next appointment."
      footer="If you are the salon owner, please contact support for more information."
    />
  );
}
