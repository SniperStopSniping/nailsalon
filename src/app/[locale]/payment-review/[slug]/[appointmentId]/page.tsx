import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isCustomerPaymentCreditReviewTestEnabled } from '@/libs/customerPayments/creditReviewTestGate';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Synthetic payment review', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

export default async function CustomerPaymentReviewPage(props: { params: Promise<{ locale: string; slug: string; appointmentId: string }> }) {
  if (!isCustomerPaymentCreditReviewTestEnabled()) {
    notFound();
  }
  const { slug, appointmentId } = await props.params;
  if (!slug.trim() || slug.length > 200 || !appointmentId.trim() || appointmentId.length > 200) {
    notFound();
  }
  const [{ requireRealSalonOwner }, { getSalonBySlug }] = await Promise.all([import('@/libs/adminAuth'), import('@/libs/queries')]);
  const salon = await getSalonBySlug(slug);
  if (!salon) {
    notFound();
  }
  const guard = await requireRealSalonOwner(salon.id);
  if (!guard.ok) {
    notFound();
  }
  const { CustomerPaymentReview } = await import('@/components/customerPayments/CustomerPaymentReview');
  return <main className="mx-auto max-w-2xl p-4"><CustomerPaymentReview salonSlug={slug} appointmentId={appointmentId} /></main>;
}
