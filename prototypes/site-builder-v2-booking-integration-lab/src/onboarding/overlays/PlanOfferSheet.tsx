import { Check } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import { Dialog } from '../../ui/Dialog';
import type { FoundingOfferMode, PlanIntent, PlanOfferDraft } from '../model/types';
import './plan-offer.css';

export type { FoundingOfferMode } from '../model/types';

export type OnboardingPlanOption = {
  badge?: string;
  description: string;
  enabled: boolean;
  features: readonly string[];
  id: string;
  planIntent: PlanIntent;
  priceLabel: string;
  title: string;
};

export type OnboardingPlanConfiguration = {
  comparisonRows: readonly { description: string; feature: string }[];
  foundingMode: FoundingOfferMode;
  options: readonly OnboardingPlanOption[];
};

const FREE_OPTION: OnboardingPlanOption = {
  description: 'Start using your booking page and basic website. Upgrade whenever you’re ready.',
  enabled: true,
  features: ['Online booking', 'Basic website', 'Service menu', 'Upgrade later'],
  id: 'free',
  planIntent: 'free',
  priceLabel: 'Always free to start',
  title: 'Free',
};

const FOUNDING_OPTION: OnboardingPlanOption = {
  badge: 'Early interest',
  description: 'Reserve your interest in an early Luster offer while final features and pricing are being confirmed.',
  enabled: true,
  features: [
    'Additional website tools',
    'Advanced sections',
    'More design controls',
    'Founding-member benefits to be confirmed',
  ],
  id: 'founding',
  planIntent: 'founding',
  priceLabel: 'Price coming soon',
  title: 'Founding offer',
};

const MONTHLY_OPTION: OnboardingPlanOption = {
  description: 'Tell us you’re interested in the complete monthly Luster website experience.',
  enabled: true,
  features: [
    'Complete website tools',
    'Advanced sections',
    'More customization',
    'Premium website features to be confirmed',
  ],
  id: 'monthly',
  planIntent: 'monthly',
  priceLabel: 'Price coming soon',
  title: 'Monthly plan',
};

export const createLabPlanConfiguration = (
  foundingMode: FoundingOfferMode = 'lifetime',
): OnboardingPlanConfiguration => ({
  comparisonRows: [
    { description: 'Included with every plan', feature: 'Online booking' },
    { description: 'Included with every plan', feature: 'Basic website' },
    { description: 'Planned for paid options', feature: 'Advanced website sections' },
    { description: 'Planned for paid options', feature: 'Gallery and Canva tools' },
    { description: 'Planned for paid options', feature: 'More design customization' },
  ],
  foundingMode,
  options: [
    FREE_OPTION,
    ...(foundingMode === 'hidden' ? [] : [FOUNDING_OPTION]),
    MONTHLY_OPTION,
  ],
});

const ACTION_LABELS: Record<PlanIntent, string> = {
  founding: 'Reserve founding offer',
  free: 'Continue free',
  monthly: 'I’m interested in monthly',
};

type PlanOfferSheetProps = {
  configuration?: OnboardingPlanConfiguration;
  offer: PlanOfferDraft;
  onChoose: (intent: PlanIntent) => void;
  onClose: () => void;
  open: boolean;
};

export function PlanOfferSheet({ configuration, offer, onChoose, onClose, open }: PlanOfferSheetProps) {
  const radioName = useId();
  const resolvedConfiguration = configuration ?? createLabPlanConfiguration(offer.foundingMode);
  const visibleOptions = useMemo(() => resolvedConfiguration.options.filter((option) => (
    option.enabled
    && !(option.planIntent === 'founding'
      && (offer.fixtureState === 'none' || offer.fixtureState === 'expired'))
  )), [offer.fixtureState, resolvedConfiguration.options]);
  const initialIntent = visibleOptions.some((option) => option.planIntent === 'free')
    ? 'free'
    : visibleOptions[0]?.planIntent ?? 'free';
  const [selectedIntent, setSelectedIntent] = useState<PlanIntent>(initialIntent);

  useEffect(() => {
    if (open) setSelectedIntent(initialIntent);
  }, [initialIntent, open]);

  const selectedOption = visibleOptions.find((option) => option.planIntent === selectedIntent)
    ?? visibleOptions[0];

  return (
    <Dialog
      description="Nothing is charged today. Continue free, or tell us which plan you’re interested in. Final prices and features are still being confirmed."
      initialFocusSelector="[data-dialog-title]"
      onClose={onClose}
      open={open}
      title="Your site is saved"
      variant="bottom-sheet"
    >
      <div className="onboarding-plan-sheet">
        <fieldset className="onboarding-plan-grid">
          <legend className="visually-hidden">Choose a plan interest</legend>
          {visibleOptions.map((option) => {
            const selected = option.planIntent === selectedIntent;
            return (
              <label className={`onboarding-plan-card is-${option.planIntent}${selected ? ' is-selected' : ''}`} key={option.id}>
                <input
                  checked={selected}
                  name={radioName}
                  type="radio"
                  value={option.planIntent}
                  onChange={() => setSelectedIntent(option.planIntent)}
                />
                <span className="onboarding-plan-card__selection" aria-hidden="true">
                  {selected ? <Check size={15} /> : null}
                </span>
                <span className="onboarding-plan-card__heading">
                  <span>
                    <strong>{option.title}</strong>
                    {option.badge ? <small>{option.badge}</small> : null}
                  </span>
                  <b>{option.priceLabel}</b>
                </span>
                <p>{option.description}</p>
                <ul>
                  {option.features.map((feature) => (
                    <li key={feature}><Check aria-hidden="true" size={14} /> {feature}</li>
                  ))}
                </ul>
              </label>
            );
          })}
        </fieldset>

        <details className="onboarding-plan-comparison">
          <summary>Compare what’s included</summary>
          <div className="onboarding-plan-comparison__rows">
            {resolvedConfiguration.comparisonRows.map((row) => (
              <div key={row.feature}>
                <strong>{row.feature}</strong>
                <span>{row.description}</span>
              </div>
            ))}
          </div>
        </details>

        <p className="onboarding-plan-disclaimer">
          This saves your interest only. There is no payment or plan access change today.
        </p>

        <div className="onboarding-plan-sheet__action">
          <button
            data-plan-intent={selectedOption?.planIntent}
            disabled={!selectedOption}
            type="button"
            onClick={() => { if (selectedOption) onChoose(selectedOption.planIntent); }}
          >
            {ACTION_LABELS[selectedOption?.planIntent ?? 'free']}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
