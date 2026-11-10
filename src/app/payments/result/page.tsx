import type { Metadata } from 'next';

import CustomerPaymentResult from '@/components/customerPayments/CustomerPaymentResult';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Payment status | Luster',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function PaymentResultPage() {
  return <CustomerPaymentResult />;
}
