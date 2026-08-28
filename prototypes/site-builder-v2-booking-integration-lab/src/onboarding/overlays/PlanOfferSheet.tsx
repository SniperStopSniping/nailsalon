import { Check, Clock3, Crown, Sparkles } from 'lucide-react';

import { Dialog } from '../../ui/Dialog';
import type { PlanIntent, PlanOfferDraft } from '../model/types';

export const LAB_PLAN_CONFIGURATION = {
  lifetime: {
    features: ['Complete website tools', 'Included future website updates', 'Founding member recognition'],
    pricePlaceholder: 'Founding one-time price',
  },
  monthly: {
    features: ['Complete website tools', 'Cancel later', 'Ongoing product updates'],
    pricePlaceholder: 'Monthly price',
  },
} as const;

type PlanOfferSheetProps = {
  offer: PlanOfferDraft;
  onChoose: (intent: PlanIntent) => void;
  onClose: () => void;
  open: boolean;
};

export function PlanOfferSheet({ offer, onChoose, onClose, open }: PlanOfferSheetProps) {
  const lifetimeAvailable = offer.fixtureState !== 'expired' && offer.fixtureState !== 'none';
  const offerMessage = offer.fixtureState === 'available'
    ? 'Founding offer available'
    : offer.fixtureState === 'expiring'
      ? 'Founding offer ending soon'
      : offer.fixtureState === 'expired'
        ? 'Founding offer has ended'
        : 'Choose the option that fits you';

  return (
    <Dialog
      description="Continue free, or choose a plan for the complete Luster website experience. You won’t be charged today."
      initialFocusSelector="[data-dialog-title]"
      onClose={onClose}
      open={open}
      title="Your site is saved"
      variant="bottom-sheet"
    >
      <div className="onboarding-plan-sheet">
        <p className="onboarding-prototype-state"><Clock3 aria-hidden="true" size={15} /> {offerMessage}</p>
        <div className="onboarding-plan-grid">
          <article className={`onboarding-plan-card is-lifetime${lifetimeAvailable ? '' : ' is-unavailable'}`}>
            <Crown aria-hidden="true" size={24} />
            <span>Founding lifetime option</span>
            <h3>Founding Nail Tech Lifetime Access</h3>
            <p>One payment. Keep the included website tools for life.</p>
            <strong>{LAB_PLAN_CONFIGURATION.lifetime.pricePlaceholder}</strong>
            <ul>{LAB_PLAN_CONFIGURATION.lifetime.features.map((feature) => <li key={feature}><Check aria-hidden="true" size={14} /> {feature}</li>)}</ul>
            <button
              aria-label={lifetimeAvailable
                ? 'Choose Founding Nail Tech Lifetime Access'
                : 'Founding Nail Tech Lifetime Access unavailable'}
              disabled={!lifetimeAvailable}
              type="button"
              onClick={() => onChoose('lifetime')}
            >
              {lifetimeAvailable ? 'Unlock lifetime access' : 'Lifetime offer unavailable'}
            </button>
          </article>
          <article className="onboarding-plan-card">
            <Sparkles aria-hidden="true" size={24} />
            <span>Monthly option</span>
            <h3>Monthly plan</h3>
            <p>Unlock the complete website tools with a monthly plan.</p>
            <strong>{LAB_PLAN_CONFIGURATION.monthly.pricePlaceholder}</strong>
            <ul>{LAB_PLAN_CONFIGURATION.monthly.features.map((feature) => <li key={feature}><Check aria-hidden="true" size={14} /> {feature}</li>)}</ul>
            <button
              aria-label="Choose Monthly plan"
              type="button"
              onClick={() => onChoose('monthly')}
            >
              Choose monthly
            </button>
          </article>
          <article className="onboarding-plan-card is-free">
            <span>Free option</span>
            <h3>Continue free</h3>
            <p>Keep using the free version and upgrade later.</p>
            <strong>Free to continue</strong>
            <button data-plan-intent="free" type="button" onClick={() => onChoose('free')}>Continue free</button>
          </article>
        </div>
        <p className="onboarding-plan-disclaimer">You can keep using Luster free and choose a plan later.</p>
      </div>
    </Dialog>
  );
}
