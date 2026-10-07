import './plan-offer.css';

import { useEffect, useRef, useState } from 'react';

import { FoundingSalonOffer } from '../../../../../src/components/owner-entry/FoundingSalonOffer';
import { LusterEntryShell } from '../../../../../src/components/owner-entry/LusterEntryShell';
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
  comparisonRows: readonly { feature: string; group: 'included_now' | 'planned_paid' }[];
  foundingMode: FoundingOfferMode;
  options: readonly OnboardingPlanOption[];
  showPlanComparison: boolean;
};

export const createLabPlanConfiguration = (
  foundingMode: FoundingOfferMode = 'lifetime',
): OnboardingPlanConfiguration => ({
  comparisonRows: [],
  foundingMode,
  options: foundingMode === 'hidden'
    ? []
    : [{
        badge: 'Ends Jan 1, 2027',
        description: 'Join during our founding period and never pay a monthly software fee for the core app.',
        enabled: true,
        features: ['Online booking', 'Website builder', 'Service menu', 'Client management', 'Reviews & rebooking', 'Premium layouts & customization', '100 free texts included', 'Unlimited emails'],
        id: 'founding',
        planIntent: 'founding',
        priceLabel: '$0/month for life',
        title: 'Founding salon offer',
      }],
  showPlanComparison: false,
});

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
  const [choosing, setChoosing] = useState(false);
  const resolvedConfiguration = configuration ?? createLabPlanConfiguration(offer.foundingMode);
  const available = offer.fixtureState !== 'none' && offer.fixtureState !== 'expired'
    && resolvedConfiguration.options.some(option => option.enabled && option.planIntent === 'founding');

  useEffect(() => {
    if (open) {
      choosingRef.current = false;
      setChoosing(false);
    }
  }, [open]);

  const choose = () => {
    if (choosingRef.current) {
      return;
    }
    choosingRef.current = true;
    setChoosing(true);
    feedback.send({ kind: 'selection' });
    onChoose(available ? 'founding' : 'free');
  };

  return (
    <Dialog
      initialFocusSelector="[data-dialog-title]"
      onClose={onClose}
      open={open}
      title="Your site is ready"
      variant="bottom-sheet"
    >
      <div className="luster-offer-dialog">
        {available
          ? <FoundingSalonOffer onClaim={choose} pending={choosing} />
          : (
              <LusterEntryShell variant="offer">
                <header className="luster-entry-header">
                  <h2>The founding offer is unavailable</h2>
                  <p>Your saved salon is still ready for you.</p>
                </header>
                <button className="luster-entry-button luster-entry-button--primary" type="button" disabled={choosing} onClick={choose}>
                  {choosing ? 'Opening your salon…' : 'Open my salon'}
                </button>
              </LusterEntryShell>
            )}
      </div>
    </Dialog>
  );
}
