/**
 * Public pricing page — Gate C2 (contract §12).
 *
 * DARK BY DEFAULT: unset PUBLIC_PRICING_ENABLED means this route 404s via
 * notFound() before rendering anything — hiding the page is presentation,
 * but the actual control boundary is server-side (Checkout rejects
 * independently). Content is the CANONICAL catalogue projection only: no
 * Stripe IDs (getPublicBillingOffers strips them structurally), no invented
 * feature matrix (§12 — legacy tiers stay authoritative for features), and
 * founding language renders ONLY when the promotion window is configured
 * and open, which in the committed state it never is.
 */
import { notFound } from 'next/navigation';

import { getPublicBillingOffers } from '@/libs/billing/billingOffers';
import { getPlanDefinition } from '@/libs/billing/planDefinitions';
import { getPromotion, isPromotionWindowOpen } from '@/libs/billing/promotions';
import { Env } from '@/libs/Env';

export const dynamic = 'force-dynamic';

const CENTS = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function PricingPage() {
  if (Env.PUBLIC_PRICING_ENABLED !== 'true') {
    notFound();
  }
  const offers = getPublicBillingOffers();
  const monthly = offers.filter(offer => offer.cadence === 'monthly');
  const annual = offers.filter(offer => offer.cadence === 'annual');
  const founding = getPromotion('founding_annual_2026');
  const foundingOpen = founding !== null && isPromotionWindowOpen(founding, new Date());

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-12">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Plans & pricing</h1>
        <p className="text-[15px] text-gray-500">
          Prices in CAD, plus applicable taxes. Email confirmations and
          reminders are included with every plan.
        </p>
      </header>

      <section aria-labelledby="monthly-heading" className="space-y-3">
        <h2 id="monthly-heading" className="text-xl font-medium">Monthly</h2>
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {monthly.map(offer => (
            <li key={offer.key} className="flex items-center justify-between p-4">
              <span className="text-[16px]">{getPlanDefinition(offer.planDefinitionKey)?.displayName ?? offer.planDefinitionKey}</span>
              <span className="text-[16px] font-medium">
                {CENTS(offer.priceCents)}
                <span className="text-[13px] font-normal text-gray-500"> / month</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="annual-heading" className="space-y-3">
        <h2 id="annual-heading" className="text-xl font-medium">Annual</h2>
        <p className="text-[14px] text-gray-500">Pay annually and get two months free.</p>
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {annual.map(offer => (
            <li key={offer.key} className="flex items-center justify-between p-4">
              <span className="text-[16px]">{getPlanDefinition(offer.planDefinitionKey)?.displayName ?? offer.planDefinitionKey}</span>
              <span className="text-[16px] font-medium">
                {CENTS(offer.priceCents)}
                <span className="text-[13px] font-normal text-gray-500"> / year</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-gray-500">
          Annual plans renew at the standard annual price shown above.
        </p>
      </section>

      {foundingOpen && (
        <section aria-labelledby="founding-heading" className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h2 id="founding-heading" className="text-lg font-medium">Founding offer</h2>
          <p className="text-[14px] text-gray-700">
            50% off your first year compared with paying monthly, with your
            founding base rate protected for 24 months. Your plan renews at
            the standard annual price.
          </p>
        </section>
      )}
    </main>
  );
}
