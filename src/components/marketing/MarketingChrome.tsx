import Link from 'next/link';

import { getMarketingLocale, LUSTER_SHOP_URL, marketingCopy, marketingPages } from '@/libs/marketingContent';
import { marketingPath } from '@/libs/marketingSeo';

export function MarketingHeader({ locale, path = '/' }: { locale: string; path?: string }) {
  const language = getMarketingLocale(locale);
  const copy = marketingCopy[language];
  // A full navigation updates the shared html root; /en also resets a French locale cookie.
  const languageHref = language === 'fr' ? `/en${path === '/' ? '' : path}` : marketingPath(path, 'fr');

  return (
    <header className="mx-auto grid max-w-6xl grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-5 sm:px-8 lg:grid-cols-[auto_1fr_auto]">
      <Link href={marketingPath('/', language)} className="inline-flex min-h-11 items-center text-xl font-black tracking-[0.18em] text-[#a70f3c]">LUSTER</Link>
      <nav aria-label={language === 'fr' ? 'Navigation principale' : 'Main navigation'} className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:justify-end">
        <Link href={marketingPath('/nail-salon-booking-software', language)} className="inline-flex min-h-11 items-center">{language === 'fr' ? 'Pour les salons' : 'For salons'}</Link>
        <Link href={marketingPath('/free-booking', language)} className="inline-flex min-h-11 items-center">{language === 'fr' ? 'Ce qui est inclus' : 'What’s included'}</Link>
        <a href={languageHref} hrefLang={language === 'fr' ? 'en' : 'fr'} aria-label={copy.languageLabel} className="inline-flex min-h-11 items-center">{copy.language}</a>
        <Link href={marketingPath('/owner-sign-in', language)} className="inline-flex min-h-11 items-center">{copy.owner}</Link>
      </nav>
      <a href={LUSTER_SHOP_URL} className="col-start-2 row-start-1 inline-flex min-h-11 items-center justify-center justify-self-end rounded-full border border-stone-300 bg-white px-4 py-2.5 text-center text-sm font-semibold shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a70f3c] lg:col-start-3">{copy.shop}</a>
    </header>
  );
}

export function MarketingFooter({ locale }: { locale: string }) {
  const language = getMarketingLocale(locale);
  const copy = marketingCopy[language];

  return (
    <footer className="mx-auto max-w-6xl border-t border-rose-100 px-5 py-8 sm:px-8">
      <nav aria-label={language === 'fr' ? 'Ressources Luster' : 'Luster resources'} className="mb-6 grid gap-x-6 sm:grid-cols-2">
        {Object.values(marketingPages[language]).map(page => (
          <Link key={page.path} href={marketingPath(page.path, language)} className="inline-flex min-h-11 items-center text-sm font-semibold text-stone-700 underline underline-offset-4">{page.title.replace(' | Luster', '')}</Link>
        ))}
      </nav>
      <div className="flex flex-col gap-3 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between">
        <p>Luster</p>
        <nav aria-label={language === 'fr' ? 'Informations légales et assistance' : 'Legal and support'} className="flex flex-wrap gap-5">
          <Link href={marketingPath('/privacy', language)} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{copy.privacy}</Link>
          <Link href={marketingPath('/terms', language)} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{copy.terms}</Link>
          <a href="mailto:support@lustergel.app" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{copy.contact}</a>
        </nav>
      </div>
    </footer>
  );
}
