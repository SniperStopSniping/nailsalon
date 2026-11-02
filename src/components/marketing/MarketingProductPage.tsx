import Link from 'next/link';

import { getMarketingLocale, marketingCopy, type MarketingPageKey, marketingPages } from '@/libs/marketingContent';
import { marketingPath } from '@/libs/marketingSeo';

import { MarketingFooter, MarketingHeader } from './MarketingChrome';

export function MarketingProductPage({ locale, pageKey, websiteSetupEnabled }: {
  locale: string;
  pageKey: MarketingPageKey;
  websiteSetupEnabled: boolean;
}) {
  const language = getMarketingLocale(locale);
  const copy = marketingCopy[language];
  const page = marketingPages[language][pageKey];

  return (
    <div className="min-h-screen bg-[#fffaf7] text-stone-950">
      <MarketingHeader locale={language} path={page.path} />
      <main className="mx-auto max-w-4xl px-5 pb-16 pt-12 sm:px-8 sm:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#a70f3c]">{copy.eyebrow}</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-6xl">{page.heading}</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-stone-600">{page.intro}</p>
        <div className="mt-12 space-y-8">
          {page.sections.map(section => (
            <section key={section.heading} className="rounded-3xl border border-rose-100 bg-white p-6 sm:p-8">
              <h2 className="text-2xl font-bold tracking-tight">{section.heading}</h2>
              <p className="mt-4 leading-8 text-stone-600">{section.body}</p>
            </section>
          ))}
        </div>
        {pageKey === 'website' && (
          <section className="mt-12" aria-labelledby="product-demo-title">
            <h2 id="product-demo-title" className="text-2xl font-bold tracking-tight">{copy.demo}</h2>
            <p className="mt-4 leading-7 text-stone-600">{copy.demoBody}</p>
            <video controls playsInline preload="none" poster="/assets/videos/luster-ai-builder-poster.jpg" aria-label={copy.demo} className="mt-6 aspect-video w-full rounded-2xl bg-stone-100">
              <source src="/assets/videos/luster-ai-builder-demo.webm" type="video/webm" />
              <source src="/assets/videos/luster-ai-builder-demo.mp4" type="video/mp4" />
              <track kind="captions" src="/assets/videos/luster-ai-builder-demo.vtt" srcLang="en" label={copy.captions} default />
              <a href="/assets/videos/luster-ai-builder-demo.mp4">{copy.videoFallback}</a>
            </video>
            <details className="mt-4 leading-7 text-stone-600">
              <summary className="min-h-11 cursor-pointer font-semibold text-stone-900">{copy.transcript}</summary>
              <p className="mt-3">{copy.transcriptBody}</p>
            </details>
          </section>
        )}
        <section className="mt-12" aria-labelledby="product-faq-title">
          <h2 id="product-faq-title" className="text-2xl font-bold tracking-tight">{copy.faq}</h2>
          <div className="mt-5 divide-y divide-rose-100">
            {page.questions.map(item => (
              <details key={item.question} className="py-4">
                <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">{item.question}</summary>
                <p className="mt-3 leading-7 text-stone-600">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="mt-12 rounded-3xl bg-[#f6e8ed] p-6 sm:p-8">
          <h2 className="text-2xl font-bold tracking-tight">{copy.cta}</h2>
          <p className="mt-3 leading-7 text-stone-700">{copy.ctaBody}</p>
          <Link href={marketingPath(websiteSetupEnabled ? '/onboarding-v1' : '/owner-sign-in', language)} className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-[#b80f43] px-6 py-3.5 text-center font-bold text-white">{websiteSetupEnabled ? copy.start : copy.dashboard}</Link>
        </section>
      </main>
      <MarketingFooter locale={language} />
    </div>
  );
}
