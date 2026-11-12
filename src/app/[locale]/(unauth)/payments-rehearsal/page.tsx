import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CustomerPaymentsRehearsal } from '@/components/customerPayments/CustomerPaymentsRehearsal';
import { isCustomerPaymentsRehearsalEnabled } from '@/libs/customerPayments/rehearsal';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Customer payments test setup',
  robots: { index: false, follow: false },
};

export default function CustomerPaymentsRehearsalPage() {
  if (!isCustomerPaymentsRehearsalEnabled()) {
    notFound();
  }
  return <CustomerPaymentsRehearsal />;
}
