import { ArrowRight, Check, Crown, Heart, MessageCircle, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';

import { LusterEntryShell, LusterWordmark } from './LusterEntryShell';

const CORE_FEATURES = [
  'Online booking',
  'Website builder',
  'Service menu',
  'Client management',
  'Reviews & rebooking',
  'Premium layouts & customization',
];

/** Presentation only. The caller owns eligibility, claim persistence and navigation. */
export function FoundingSalonOffer({
  children,
  onClaim,
  pending = false,
  message,
  closed = false,
  onContinue,
}: {
  children?: ReactNode;
  onClaim: () => void;
  pending?: boolean;
  message?: string | null;
  closed?: boolean;
  onContinue?: () => void;
}) {
  if (closed) {
    return (
      <LusterEntryShell variant="offer">
        <main>
          <LusterWordmark />
          <header className="luster-entry-header luster-offer-header">
            <p className="luster-offer-eyebrow">Your site is saved</p>
            <h1>
              Your next chapter
              <br />
              <em>starts here.</em>
            </h1>
          </header>
          <section className="luster-entry-card luster-offer-card">
            <h2>Your core Luster app is free</h2>
            <p>Your saved site is ready to open. There is no monthly software subscription, and any lifetime access you already claimed stays active.</p>
          </section>
          <footer className="luster-offer-claim">
            <button className="luster-entry-button luster-entry-button--primary" type="button" disabled={!onContinue} onClick={onContinue}>
              Go to my dashboard
              <ArrowRight aria-hidden="true" />
            </button>
          </footer>
          {children}
        </main>
      </LusterEntryShell>
    );
  }
  return (
    <LusterEntryShell variant="offer">
      <main>
        <LusterWordmark />
        <header className="luster-entry-header luster-offer-header">
          <p className="luster-offer-eyebrow">
            <Sparkles aria-hidden="true" />
            Your site is ready
          </p>
          <h1>
            Your Luster app
            <br />
            <em>free for life</em>
          </h1>
          <p>Your website, booking and salon tools, with no monthly software subscription. Built for nail techs and salons ready to grow.</p>
        </header>
        <section className="luster-entry-card luster-offer-card" aria-labelledby="founding-offer-title">
          <div className="luster-offer-card-top">
            <h2 id="founding-offer-title">
              <Crown aria-hidden="true" />
              Your free core plan
            </h2>
            <span className="luster-offer-deadline">
              <ShieldCheck aria-hidden="true" />
              No subscription
            </span>
          </div>
          <p className="luster-entry-price">
            <span>$0</span>
            <span>
              /month
              <em>for life</em>
            </span>
          </p>
          <p className="luster-offer-description">Accept bookings and manage your salon with no monthly software fee.</p>
          <ul className="luster-offer-features">
            {CORE_FEATURES.map(feature => (
              <li key={feature}>
                <Check aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <ul className="luster-offer-included">
            <li>
              <Check aria-hidden="true" />
              <strong>100 free texts included</strong>
            </li>
            <li>
              <Check aria-hidden="true" />
              <strong>Unlimited emails</strong>
            </li>
          </ul>
          <p className="luster-offer-description">Eligible salons receive a one-time allowance per verified business. Verify your email and phone to claim your texts.</p>
        </section>
        <aside className="luster-entry-card luster-offer-usage" aria-labelledby="usage-heading">
          <span className="luster-offer-usage-icon"><MessageCircle aria-hidden="true" /></span>
          <div>
            <h2 id="usage-heading">Extra texts, when you need them</h2>
            <p>Optional one-time SMS top-ups. Purchased texts never expire. No subscription required.</p>
          </div>
        </aside>
        <ul className="luster-offer-reassurance" aria-label="Offer details">
          <li>
            <ShieldCheck aria-hidden="true" />
            <span>
              No monthly
              <br />
              software fee
            </span>
          </li>
          <li>
            <Heart aria-hidden="true" />
            <span>
              No charge
              <br />
              today
            </span>
          </li>
          <li>
            <UsersRound aria-hidden="true" />
            <span>
              Built for nail techs
              <br />
              &amp; salons
            </span>
          </li>
        </ul>
        {message && <p role="status" className="luster-entry-error">{message}</p>}
        <footer className="luster-offer-claim">
          <button className="luster-entry-button luster-entry-button--primary" type="button" disabled={pending} onClick={onClaim}>
            <span>{pending ? 'Saving your claim…' : 'Claim my free lifetime plan'}</span>
            <ArrowRight aria-hidden="true" />
          </button>
          <p>No card needed. Your core app stays free.</p>
        </footer>
        {children}
      </main>
    </LusterEntryShell>
  );
}
