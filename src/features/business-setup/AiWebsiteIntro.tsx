import './ai-entry.css';

import Link from 'next/link';
import type { ReactNode } from 'react';

export function AiWebsiteIntro({ locale, showGetStarted = false, children }: { locale: string; showGetStarted?: boolean; children?: ReactNode }) {
  const url = `/${locale}/ai-website`;
  return (
    <main className="ai-entry">
      <header className="ai-entry-nav">
        <a href={`/${locale}/onboarding-v1`} aria-label="Back to website choices">← Website choices</a>
        <span>✦ LUSTER</span>
      </header>
      <section className="ai-entry-hero">
        <p className="ai-entry-eyebrow">YOUR IDEAS. BROUGHT TO LIFE.</p>
        <h1>
          Your business.
          <br />
          Your kind of beautiful.
        </h1>
        <p>Show Luster a design you love, or describe something original. AI builds your booking website and helps put your business details together.</p>
        {showGetStarted && (
          <div className="ai-entry-actions">
            <a className="ai-entry-primary" href={`${url}?account=sign-up`}>Build with AI · from $10 CAD</a>
            <a href={`${url}?account=sign-in`}>I already have an account</a>
          </div>
        )}
      </section>
      <section className="ai-entry-how" aria-labelledby="ai-entry-how-title">
        <h2 id="ai-entry-how-title">Tell us. See it. Make it yours.</h2>
        <ol>
          <li>
            <span>01</span>
            <h3>Tell us about your business</h3>
            <p>Use your saved details, type a little, or let AI read your own design or menu.</p>
          </li>
          <li>
            <span>02</span>
            <h3>Show us your style</h3>
            <p>Upload Canva artwork, inspiration and photos, or describe the website you imagine.</p>
          </li>
          <li>
            <span>03</span>
            <h3>Watch your website take shape</h3>
            <p>Refine it in chat. Check your services, prices, hours and supported booking settings in the same draft.</p>
          </li>
          <li>
            <span>04</span>
            <h3>Approve when it feels right</h3>
            <p>Review the exact changes, then publish. Booking runs through Luster.</p>
          </li>
        </ol>
      </section>
      <section className="ai-entry-value">
        <h2>One place to build. And keep improving.</h2>
        <p>Credits cover AI design and business-setting changes. Come back through More → Luster AI whenever you want to update things.</p>
        <p>Start with $10, $20 or $50 CAD in one-time credits. Every pack includes the same AI features. Usage depends on your requests; extra credits are optional. Ordinary bookings and manual editing do not use AI credits.</p>
        <p>You’ll see a request limit before sending. Your website stays saved when your balance runs out.</p>
      </section>
      {children}
      <footer>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <a href={`/${locale}/onboarding-v1`}>Prefer to set up manually?</a>
      </footer>
    </main>
  );
}
