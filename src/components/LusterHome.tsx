import { CalendarCheck2, Mail, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { MarketingFooter, MarketingHeader } from '@/components/marketing/MarketingChrome';
import { getMarketingLocale, LUSTER_SHOP_URL, marketingCopy, marketingPages } from '@/libs/marketingContent';
import { buildMarketingJsonLd, marketingPath } from '@/libs/marketingSeo';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

export function LusterHome({ locale = 'en', websiteSetupEnabled = false }: {
  locale?: string;
  websiteSetupEnabled?: boolean;
}) {
  const language = getMarketingLocale(locale);
  const copy = marketingCopy[language];
  const features = language === 'fr' ? fr.LusterHome : en.LusterHome;

  return (
    <div className="min-h-screen bg-[#fffaf7] text-stone-950">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildMarketingJsonLd(language)).replace(/</gu, '\\u003c') }} />
      <MarketingHeader locale={language} />
      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:py-20">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#a70f3c]">{copy.eyebrow}</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.05] tracking-[-0.04em] sm:text-6xl">{copy.heading}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-600">{copy.intro}</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              {websiteSetupEnabled
                ? <Link href={marketingPath('/onboarding-v1', language)} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#b80f43] px-6 py-3.5 text-center font-bold text-white shadow-lg shadow-rose-900/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a70f3c]">{copy.start}</Link>
                : <a href="mailto:support@lustergel.app?subject=Luster%20booking%20invite" className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#b80f43] px-6 py-3.5 text-center font-bold text-white shadow-lg shadow-rose-900/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a70f3c]">{copy.invite}</a>}
              <a href={LUSTER_SHOP_URL} className="inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3.5 text-center font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a70f3c]">{copy.shop}</a>
            </div>
            <p className="mt-5 text-sm leading-6 text-stone-600">{features.preview_reassurance}</p>
            <p className="mt-4 text-sm leading-6 text-stone-600">{features.customer_help}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {[
              { icon: CalendarCheck2, title: features.scheduling_title, body: features.scheduling_copy },
              { icon: Mail, title: features.booking_title, body: features.booking_copy },
              { icon: Sparkles, title: features.website_title, body: features.website_copy },
            ].map(item => (
              <article key={item.title} className="rounded-[1.75rem] border border-rose-100 bg-white p-6 shadow-[0_18px_50px_rgba(70,35,35,0.07)]">
                <item.icon aria-hidden="true" className="size-6 text-[#b80f43]" />
                <h2 className="mt-4 text-xl font-bold">{item.title}</h2>
                <p className="mt-2 leading-7 text-stone-600">{item.body}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-8" aria-labelledby="booking-workflow-title">
          <h2 id="booking-workflow-title" className="max-w-3xl text-3xl font-bold tracking-tight">{copy.workflow}</h2>
          <ol className="mt-8 grid list-none gap-6 md:grid-cols-3">
            {copy.steps.map((step, index) => (
              <li key={step.heading} className="rounded-3xl border border-rose-100 bg-white p-6">
                <span aria-hidden="true" className="text-sm font-bold text-[#a70f3c]">
                  0
                  {index + 1}
                </span>
                <h3 className="mt-3 text-xl font-bold">{step.heading}</h3>
                <p className="mt-3 leading-7 text-stone-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-8" aria-labelledby="booking-cost-title">
          <div className="rounded-3xl bg-[#f6e8ed] p-7 sm:p-10">
            <h2 id="booking-cost-title" className="max-w-3xl text-3xl font-bold tracking-tight">{copy.pricing}</h2>
            <p className="mt-5 max-w-3xl leading-8 text-stone-700">{copy.pricingBody}</p>
            <Link href={marketingPath('/free-booking', language)} className="mt-4 inline-flex min-h-11 items-center font-bold underline underline-offset-4">{language === 'fr' ? 'Voir ce qui est inclus' : 'See what’s included'}</Link>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-8" aria-labelledby="booking-resources-title">
          <h2 id="booking-resources-title" className="max-w-3xl text-3xl font-bold tracking-tight">{copy.explore}</h2>
          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            {Object.values(marketingPages[language]).map(page => (
              <article key={page.path} className="rounded-3xl border border-rose-100 bg-white p-6">
                <h3 className="text-xl font-bold"><Link href={marketingPath(page.path, language)} className="underline underline-offset-4">{page.title.replace(' | Luster', '')}</Link></h3>
                <p className="mt-3 leading-7 text-stone-600">{page.description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <MarketingFooter locale={language} />
    </div>
  );
}
