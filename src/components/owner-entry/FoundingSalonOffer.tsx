import { ArrowRight, Check, Clock3, Crown, Heart, MessageCircle, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';

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
  onClaim,
  pending = false,
  message,
}: {
  onClaim: () => void;
  pending?: boolean;
  message?: string | null;
}) {
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
            Lock in Luster
            <br />
            <em>free for life</em>
          </h1>
          <p>Join by January 1, 2027 and keep the core Luster app free for life. Perfect for nail techs and salons ready to grow.</p>
        </header>
        <section className="luster-entry-card luster-offer-card" aria-labelledby="founding-offer-title">
          <div className="luster-offer-card-top">
            <h2 id="founding-offer-title">
              <Crown aria-hidden="true" />
              Founding salon offer
            </h2>
            <span className="luster-offer-deadline">
              <Clock3 aria-hidden="true" />
              Ends Jan 1, 2027
            </span>
          </div>
          <p className="luster-offer-comparison">
            <span className="sr-only">Future monthly price:</span>
            <s>$49.99/month</s>
          </p>
          <p className="luster-entry-price">
            <span>$0</span>
            <span>
              /month
              <em>for life</em>
            </span>
          </p>
          <p className="luster-offer-description">Join during our founding period and never pay a monthly software fee for the core app.</p>
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
        </section>
        <aside className="luster-entry-card luster-offer-usage" aria-labelledby="usage-heading">
          <span className="luster-offer-usage-icon"><MessageCircle aria-hidden="true" /></span>
          <div>
            <h2 id="usage-heading">Usage-based features are separate</h2>
            <p>Additional SMS, AI receptionist, phone calls, and other usage-based services are billed separately.</p>
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
          <p>Founding offer available until January 1, 2027.</p>
        </footer>
      </main>
    </LusterEntryShell>
  );
}
