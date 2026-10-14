/** Public pricing stays dark by default; new subscription sales are disabled. */
import { notFound } from 'next/navigation';

import { COMMERCIAL_POLICY } from '@/libs/commercialPolicy';
import { Env } from '@/libs/Env';

export const dynamic = 'force-dynamic';

export default function PricingPage() {
  if (Env.PUBLIC_PRICING_ENABLED !== 'true') {
    notFound();
  }
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <header className="space-y-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Free booking. Text credits when you need them.</h1>
        <p className="text-base text-gray-600">Core booking software is free. No monthly subscription is required.</p>
      </header>
      <section aria-labelledby="booking-heading" className="space-y-3 rounded-2xl border border-gray-200 p-6">
        <h2 id="booking-heading" className="text-xl font-medium">Run your bookings</h2>
        <p>Manage online bookings, appointments, services and customer history. Email confirmations and reminders are included.</p>
      </section>
      <section aria-labelledby="texts-heading" className="space-y-3 rounded-2xl border border-gray-200 p-6">
        <h2 id="texts-heading" className="text-xl font-medium">Optional SMS credits</h2>
        <p>
          Eligible new businesses receive
          {' '}
          {COMMERCIAL_POLICY.starterCredits}
          {' '}
          free starter SMS credits once after contact verification.
          Additional SMS credits are one-time purchases in Usage &amp; SMS.
        </p>
        <p className="text-sm text-gray-600">SMS credits cover message segments; longer texts may use more than one credit. Current top-up prices and applicable taxes are shown before payment.</p>
      </section>
    </main>
  );
}
