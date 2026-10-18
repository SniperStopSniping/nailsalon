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
            <a className="ai-entry-primary" href={`${url}?account=sign-up#account`}>Build with AI · from $10 CAD</a>
            <a href={`${url}?account=sign-in#account`}>I already have an account</a>
          </div>
        )}
      </section>
      <section className="ai-entry-demo" aria-labelledby="ai-entry-demo-title">
        <p className="ai-entry-eyebrow">A REAL BUILD, STEP BY STEP</p>
        <h2 id="ai-entry-demo-title">See your ideas become a booking website.</h2>
        <video
          aria-label="Luster AI website builder walkthrough"
          controls
          playsInline
          preload="none"
          poster="/assets/videos/luster-ai-builder-poster.jpg"
        >
          <source src="/assets/videos/luster-ai-builder-demo.webm" type={'video/webm; codecs="vp9"'} />
          <source src="/assets/videos/luster-ai-builder-demo.mp4" type={'video/mp4; codecs="avc1.640028"'} />
          <track kind="captions" src="/assets/videos/luster-ai-builder-demo.vtt" srcLang="en" label="English walkthrough" default />
          Your browser cannot play this video. Read the walkthrough below.
        </video>
        <p className="ai-entry-demo-note">Recorded with a sample business in our test environment. Edited for time; generation speed and results vary.</p>
        <details>
          <summary>Read the walkthrough</summary>
          <ol>
            <li>Tell Luster your business name, opening hours, services, prices and appointment lengths. It saves them in your draft.</li>
            <li>Describe your style or upload a design. In this example, AI creates an original warm-white and charcoal website from a text description.</li>
            <li>Ask for a change in chat. Preview the updated design on desktop and mobile.</li>
            <li>Review the exact website and business changes. Only you can approve and publish them.</li>
            <li>A customer chooses a service and books through Luster. This recording finishes with a synthetic test appointment.</li>
          </ol>
        </details>
      </section>
      <section className="ai-entry-value">
        <h2>One place to build. And keep improving.</h2>
        <p>Credits cover AI design and business-setting changes. Come back through More → Luster AI whenever you want to update things.</p>
        <p>Start with $10, $20 or $50 CAD in one-time credits. Every pack includes the same AI features. Usage depends on your requests; extra credits are optional. Ordinary bookings and manual editing do not use AI credits.</p>
        <p>You’ll see a request limit before sending. Your website stays saved when your balance runs out.</p>
        {showGetStarted && <a className="ai-entry-primary" href={`${url}?account=sign-up#account`}>Start my website · from $10 CAD</a>}
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
