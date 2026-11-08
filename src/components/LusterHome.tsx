import { ArrowRight, Bell, CalendarCheck2, Mail, Palette, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';

import styles from '@/components/marketing/home.module.css';
import { homeContent } from '@/components/marketing/homeContent';
import { HomeHeader } from '@/components/marketing/HomeHeader';
import { HomeOffer } from '@/components/marketing/HomeOffer';
import { MarketingFooter } from '@/components/marketing/MarketingChrome';
import { ProductCarousel } from '@/components/marketing/ProductCarousel';
import { isFoundingLifetimeOfferOpen } from '@/libs/billing/foundingLifetime';
import { getMarketingLocale, marketingCopy, marketingPages } from '@/libs/marketingContent';
import { buildMarketingJsonLd, marketingPath } from '@/libs/marketingSeo';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

export function LusterHome({ locale = 'en', websiteSetupEnabled = false }: {
  locale?: string;
  websiteSetupEnabled?: boolean;
}) {
  const language = getMarketingLocale(locale);
  const copy = marketingCopy[language];
  const home = homeContent[language];
  const features = language === 'fr' ? fr.LusterHome : en.LusterHome;

  return (
    <div className={styles.home}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildMarketingJsonLd(language)).replace(/</gu, '\\u003c') }} />
      <a href="#main-content" className={styles.skip}>{home.skip}</a>
      <HomeHeader locale={language} />
      <main id="main-content">
        <section id="booking-app" className={styles.hero} aria-labelledby="home-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{home.eyebrow}</p>
            <h1 id="home-title">{home.heading}</h1>
            <p className={styles.intro}>{home.intro}</p>
            <div className={styles.actions}>
              {websiteSetupEnabled
                ? (
                    <Link href={marketingPath('/onboarding-v1', language)} className={styles.primary}>
                      {home.build}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  )
                : (
                    <a href="mailto:support@lustergel.app?subject=Luster%20booking%20invite" className={styles.primary}>
                      {copy.invite}
                      <ArrowRight aria-hidden="true" />
                    </a>
                  )}
              <Link href={marketingPath('/owner-sign-in', language)} className={styles.secondary}>{home.login}</Link>
            </div>
            {websiteSetupEnabled && <HomeOffer locale={language} initiallyOpen={isFoundingLifetimeOfferOpen()} />}
            <ul className={styles.featureRow}>
              {[CalendarCheck2, Bell, ShieldCheck, Palette].map((Icon, index) => (
                <li key={home.features[index]}>
                  <Icon aria-hidden="true" />
                  <span>{home.features[index]}</span>
                </li>
              ))}
            </ul>
          </div>
          <ProductCarousel locale={language} />
        </section>
        <section id="features" className={styles.section} aria-labelledby="home-features-title">
          <h2 id="home-features-title" className={styles.sectionHeading}>{language === 'fr' ? 'Vos réservations, votre activité. Tout est relié.' : 'Your bookings, your business. All together.'}</h2>
          <p className={styles.sectionIntro}>{features.preview_reassurance}</p>
          <div className={styles.featureCards}>
            {[
              { icon: CalendarCheck2, title: features.scheduling_title, body: features.scheduling_copy },
              { icon: Mail, title: features.booking_title, body: features.booking_copy },
              { icon: Sparkles, title: features.website_title, body: features.website_copy },
            ].map(item => (
              <article key={item.title} className={styles.featureCard}>
                <item.icon aria-hidden="true" />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
          <p className={styles.sectionIntro}>{features.customer_help}</p>
        </section>
        <section className={styles.section} aria-labelledby="booking-workflow-title">
          <h2 id="booking-workflow-title" className={styles.sectionHeading}>{copy.workflow}</h2>
          <ol className={styles.steps}>
            {copy.steps.map((step, index) => (
              <li key={step.heading}>
                <span aria-hidden="true" className={styles.stepNumber}>
                  0
                  {index + 1}
                </span>
                <h3>{step.heading}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section id="pricing" className={styles.section} aria-labelledby="booking-cost-title">
          <div className={styles.pricingPanel}>
            <h2 id="booking-cost-title" className={styles.sectionHeading}>{copy.pricing}</h2>
            <p className={styles.sectionIntro}>{copy.pricingBody}</p>
            <Link href={marketingPath('/free-booking', language)} className={styles.textLink}>{language === 'fr' ? 'Voir ce qui est inclus' : 'See what’s included'}</Link>
          </div>
        </section>
        <section id="resources" className={styles.section} aria-labelledby="booking-resources-title">
          <h2 id="booking-resources-title" className={styles.sectionHeading}>{copy.explore}</h2>
          <div className={styles.resources}>
            {Object.values(marketingPages[language]).map(page => (
              <article key={page.path}>
                <h3><Link href={marketingPath(page.path, language)} className="underline underline-offset-4">{page.title.replace(' | Luster', '')}</Link></h3>
                <p>{page.description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <div className={styles.language}><a href={language === 'fr' ? '/en' : '/fr'} hrefLang={language === 'fr' ? 'en' : 'fr'} aria-label={copy.languageLabel}>{copy.language}</a></div>
      <MarketingFooter locale={language} />
    </div>
  );
}
