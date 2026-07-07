import { AlertTriangle } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';

export const metadata = {
  title: 'Account Suspended',
  description: 'This salon account has been temporarily suspended.',
};

export default function SuspendedPage() {
  return (
    <SalonStatusPage
      icon={AlertTriangle}
      title="Account Temporarily Suspended"
      description="This salon's booking system is currently unavailable. This may be due to maintenance or an account issue. We apologize for any inconvenience — please contact the salon directly to book."
      footer="If you are the salon owner, please contact support to restore access."
    />
  );
}
