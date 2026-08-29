import { Check, Clock3, Crown, Sparkles } from 'lucide-react';

import { Dialog } from '../../ui/Dialog';
import type {
  FoundingOfferMode,
  PlanIntent,
  PlanOfferDraft,
} from '../model/types';
import './plan-offer.css';

export type { FoundingOfferMode } from '../model/types';

export type OnboardingPlanOption = {
  badge?: string;
  description: string;
  enabled: boolean;
  eyebrow: string;
  features: readonly string[];
  id: string;
  planIntent: PlanIntent;
  priceLabel: string;
  title: string;
  ctaLabel: string;
};

export type OnboardingPlanConfiguration = {
  comparisonRows: readonly {
    feature: string;
    values: Partial<Record<PlanIntent, string>>;
  }[];
  foundingMode: FoundingOfferMode;
  options: readonly OnboardingPlanOption[];
};

const FOUNDING_COPY: Record<Exclude<FoundingOfferMode, 'hidden'>, Omit<OnboardingPlanOption, 'enabled' | 'id' | 'planIntent'>> = {
  discounted_annual: {
    badge: 'Founding offer',
    ctaLabel: 'Choose founding annual offer',
    description: 'Keep a founding discount on an annual Luster plan.',
    eyebrow: 'Founding annual option',
    features: ['Founding annual rate', 'Complete website tools', 'Ongoing product updates'],
    priceLabel: 'Founding annual price',
    title: 'Founding annual access',
  },
  free_beta: {
    badge: 'Founding beta',
    ctaLabel: 'Join founding beta',
    description: 'Try the complete website experience during the founding beta.',
    eyebrow: 'Founding beta option',
    features: ['Beta access', 'Complete website tools during beta', 'Share product feedback'],
    priceLabel: 'Free during beta',
    title: 'Founding Nail Tech beta',
  },
  lifetime: {
    badge: 'Founding offer',
    ctaLabel: 'Choose founding lifetime offer',
    description: 'One payment for the website tools included in this founding offer.',
    eyebrow: 'Founding lifetime option',
    features: ['Included website tools', 'Founding offer terms', 'Founding member recognition'],
    priceLabel: 'Founding one-time price',
    title: 'Founding Nail Tech Lifetime Access',
  },
  locked_monthly: {
    badge: 'Founding offer',
    ctaLabel: 'Choose locked founding rate',
    description: 'Keep a founding monthly rate while the offer remains active.',
    eyebrow: 'Locked monthly option',
    features: ['Founding monthly rate', 'Complete website tools', 'Ongoing product updates'],
    priceLabel: 'Locked founding monthly price',
    title: 'Founding monthly rate',
  },
};

export const createLabPlanConfiguration = (
  foundingMode: FoundingOfferMode = 'lifetime',
): OnboardingPlanConfiguration => {
  const foundingCopy = foundingMode === 'hidden' ? null : FOUNDING_COPY[foundingMode];
  const options: OnboardingPlanOption[] = [];
  if (foundingCopy) {
    options.push({
      ...foundingCopy,
      enabled: true,
      id: `founding-${foundingMode}`,
      planIntent: 'founding',
    });
  }
  options.push(
    {
      ctaLabel: 'Choose monthly plan',
      description: 'Unlock the complete website tools with a monthly plan.',
      enabled: true,
      eyebrow: 'Monthly option',
      features: ['Complete website tools', 'Change plans later', 'Ongoing product updates'],
      id: 'monthly',
      planIntent: 'monthly',
      priceLabel: 'Monthly price',
      title: 'Monthly plan',
    },
    {
      ctaLabel: 'Continue free',
      description: 'Keep using the free version and upgrade later.',
      enabled: true,
      eyebrow: 'Free option',
      features: ['Online booking', 'Basic website', 'Upgrade later'],
      id: 'free',
      planIntent: 'free',
      priceLabel: 'Free to continue',
      title: 'Continue free',
    },
  );
  return {
    comparisonRows: [
      {
        feature: 'Online booking',
        values: { founding: 'Included', free: 'Included', monthly: 'Included' },
      },
      {
        feature: 'Basic website',
        values: { founding: 'Included', free: 'Included', monthly: 'Included' },
      },
      {
        feature: 'Website Builder',
        values: { founding: 'Included', free: 'Basic', monthly: 'Included' },
      },
      {
        feature: 'Gallery',
        values: { founding: 'Included', free: 'Optional upgrade', monthly: 'Included' },
      },
      {
        feature: 'Canva design',
        values: { founding: 'Included', free: 'Optional upgrade', monthly: 'Included' },
      },
      {
        feature: 'Advanced website sections',
        values: { founding: 'Included', free: 'Optional upgrade', monthly: 'Included' },
      },
    ],
    foundingMode,
    options,
  };
};

type PlanOfferSheetProps = {
  configuration?: OnboardingPlanConfiguration;
  offer: PlanOfferDraft;
  onChoose: (intent: PlanIntent) => void;
  onClose: () => void;
  open: boolean;
};

export function PlanOfferSheet({
  configuration,
  offer,
  onChoose,
  onClose,
  open,
}: PlanOfferSheetProps) {
  const resolvedConfiguration = configuration
    ?? createLabPlanConfiguration(offer.foundingMode);
  const hasFoundingOption = resolvedConfiguration.options.some((option) => (
    option.enabled && option.planIntent === 'founding'
  ));
  const foundingAvailable = offer.fixtureState !== 'expired' && offer.fixtureState !== 'none';
  const visibleOptions = resolvedConfiguration.options.filter((option) => (
    option.enabled
    && !(option.planIntent === 'founding' && offer.fixtureState === 'none')
  ));
  const offerMessage = !hasFoundingOption || offer.fixtureState === 'none'
    ? 'Choose the option that fits you'
    : offer.fixtureState === 'available'
    ? 'Founding offer available'
    : offer.fixtureState === 'expiring'
      ? 'Founding offer ending soon'
      : offer.fixtureState === 'expired'
        ? 'Founding offer has ended'
        : 'Choose the option that fits you';

  return (
    <Dialog
      description="Continue free, or choose a plan to unlock more Luster website features. You won’t be charged today."
      initialFocusSelector="[data-dialog-title]"
      onClose={onClose}
      open={open}
      title="Your site is saved"
      variant="bottom-sheet"
    >
      <div className="onboarding-plan-sheet">
        <p className="onboarding-prototype-state"><Clock3 aria-hidden="true" size={15} /> {offerMessage}</p>
        <div className="onboarding-plan-grid">
          {visibleOptions.map((option) => {
            const isFounding = option.planIntent === 'founding';
            const enabled = option.enabled && (!isFounding || foundingAvailable);
            const Icon = isFounding ? Crown : option.planIntent === 'monthly' ? Sparkles : null;
            return (
              <article
                className={`onboarding-plan-card${isFounding ? ' is-founding' : option.planIntent === 'free' ? ' is-free' : ''}${enabled ? '' : ' is-unavailable'}`}
                key={option.id}
              >
                {Icon ? <Icon aria-hidden="true" size={24} /> : null}
                <span>{option.eyebrow}</span>
                {option.badge ? <small>{option.badge}</small> : null}
                <h3>{option.title}</h3>
                <p>{option.description}</p>
                <strong>{option.priceLabel}</strong>
                <ul>{option.features.map((feature) => <li key={feature}><Check aria-hidden="true" size={14} /> {feature}</li>)}</ul>
                <button
                  aria-label={enabled ? option.ctaLabel : `${option.title} unavailable`}
                  data-plan-intent={option.planIntent}
                  disabled={!enabled}
                  type="button"
                  onClick={() => onChoose(option.planIntent)}
                >
                  {enabled ? option.ctaLabel : 'Offer unavailable'}
                </button>
              </article>
            );
          })}
        </div>
        <details className="onboarding-plan-comparison">
          <summary>Compare plans</summary>
          <div className="onboarding-plan-comparison__scroll">
            <table className="onboarding-plan-comparison__table">
              <caption className="visually-hidden">Plan feature comparison</caption>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {visibleOptions.map((option) => (
                    <th key={option.id} scope="col">{option.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resolvedConfiguration.comparisonRows.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row">{row.feature}</th>
                    {visibleOptions.map((option) => (
                      <td key={option.id}>{row.values[option.planIntent] ?? 'Not included'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="onboarding-plan-disclaimer">Prices and included features are shown for review and may change.</p>
      </div>
    </Dialog>
  );
}
