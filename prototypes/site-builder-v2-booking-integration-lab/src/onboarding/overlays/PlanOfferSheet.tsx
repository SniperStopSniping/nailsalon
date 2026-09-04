import './plan-offer.css';

import { Check } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Dialog } from '../../ui/Dialog';
import { useFeedback } from '../feedback/useFeedback';
import type { FoundingOfferMode, PlanIntent, PlanOfferDraft } from '../model/types';

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
  comparisonRows: readonly {
    feature: string;
    group: 'included_now' | 'planned_paid';
  }[];
  foundingMode: FoundingOfferMode;
  options: readonly OnboardingPlanOption[];
  showPlanComparison: boolean;
};

const FREE_OPTION: OnboardingPlanOption = {
  description: 'Start using your booking page, service menu and basic website.',
  enabled: true,
  features: ['Online booking', 'Basic website', 'Service menu', 'Upgrade later'],
  id: 'free',
  planIntent: 'free',
  priceLabel: '$0 to start',
  title: 'Free',
};

const FOUNDING_OPTION: OnboardingPlanOption = {
  badge: 'Early interest',
  description: 'Reserve your interest in an early Luster offer while final details are confirmed.',
  enabled: true,
  features: [
    'More website tools',
    'Advanced sections',
    'Additional design options',
    'Founding benefits to be confirmed',
  ],
  id: 'founding',
  planIntent: 'founding',
  priceLabel: 'Price coming soon',
  title: 'Founding offer',
};

const MONTHLY_OPTION: OnboardingPlanOption = {
  description: 'Tell us you are interested in Luster’s complete monthly website experience.',
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
  title: 'Monthly',
};

export const createLabPlanConfiguration = (
  foundingMode: FoundingOfferMode = 'lifetime',
): OnboardingPlanConfiguration => ({
  comparisonRows: [
    { feature: 'Online booking', group: 'included_now' },
    { feature: 'Basic website', group: 'included_now' },
    { feature: 'Service menu', group: 'included_now' },
    { feature: 'More website sections', group: 'planned_paid' },
    { feature: 'Gallery and Canva tools', group: 'planned_paid' },
    { feature: 'Additional customization', group: 'planned_paid' },
  ],
  foundingMode,
  options: [
    FREE_OPTION,
    ...(foundingMode === 'hidden' ? [] : [FOUNDING_OPTION]),
    MONTHLY_OPTION,
  ],
  showPlanComparison: true,
});

const COMPARISON_GROUPS = [
  { id: 'included_now', label: 'Included now' },
  { id: 'planned_paid', label: 'Planned for paid options' },
] as const;

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
  const feedback = useFeedback();
  const choosingRef = useRef(false);
  const radioName = useId();
  const resolvedConfiguration = configuration ?? createLabPlanConfiguration(offer.foundingMode);
  const visibleOptions = useMemo(() => resolvedConfiguration.options.filter(option => (
    option.enabled
    && !(option.planIntent === 'founding'
      && (offer.fixtureState === 'none' || offer.fixtureState === 'expired'))
  )), [offer.fixtureState, resolvedConfiguration.options]);
  const initialIntent = visibleOptions.some(option => option.planIntent === 'free')
    ? 'free'
    : visibleOptions[0]?.planIntent ?? 'free';
  const [selectedIntent, setSelectedIntent] = useState<PlanIntent>(initialIntent);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    if (open) {
      choosingRef.current = false;
      setChoosing(false);
      setSelectedIntent(initialIntent);
    }
  }, [initialIntent, open]);

  const selectedOption = visibleOptions.find(option => option.planIntent === selectedIntent)
    ?? visibleOptions[0];

  return (
    <Dialog
      description="Start free today, or tell us which future Luster plan interests you. Nothing is charged now, and you can upgrade later."
      initialFocusSelector="[data-dialog-title]"
      onClose={onClose}
      open={open}
      title="Your site is saved"
      variant="bottom-sheet"
    >
      <div className="onboarding-plan-sheet">
        <p className="onboarding-plan-sheet__status-note">
          Final paid-plan pricing and features are still being confirmed.
        </p>
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
                  onChange={() => {
                    feedback.send({ kind: 'selection' });
                    setSelectedIntent(option.planIntent);
                  }}
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
                  {option.features.map(feature => (
                    <li key={feature}>
                      <Check aria-hidden="true" size={14} />
                      {' '}
                      {feature}
                    </li>
                  ))}
                </ul>
              </label>
            );
          })}
        </fieldset>

        {resolvedConfiguration.showPlanComparison
          ? (
              <details className="onboarding-plan-comparison">
                <summary>Compare options</summary>
                <div className="onboarding-plan-comparison__groups">
                  {COMPARISON_GROUPS.map((group) => {
                    const rows = resolvedConfiguration.comparisonRows.filter(
                      row => row.group === group.id,
                    );
                    return rows.length > 0
                      ? (
                          <section key={group.id}>
                            <h3>{group.label}</h3>
                            <ul>
                              {rows.map(row => (
                                <li key={row.feature}>
                                  <Check aria-hidden="true" size={14} />
                                  <span>{row.feature}</span>
                                </li>
                              ))}
                            </ul>
                          </section>
                        )
                      : null;
                  })}
                </div>
              </details>
            )
          : null}

        <p className="onboarding-plan-disclaimer">
          This saves your interest only. There is no payment or plan access change today.
        </p>

        <div className="onboarding-plan-sheet__action">
          <button
            data-plan-intent={selectedOption?.planIntent}
            disabled={!selectedOption || choosing}
            type="button"
            onClick={() => {
              if (!selectedOption || choosingRef.current) {
                return;
              }
              choosingRef.current = true;
              setChoosing(true);
              onChoose(selectedOption.planIntent);
              window.setTimeout(() => {
                choosingRef.current = false;
                setChoosing(false);
              }, 0);
            }}
          >
            {choosing ? 'Continuing…' : ACTION_LABELS[selectedOption?.planIntent ?? 'free']}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
