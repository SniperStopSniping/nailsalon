import { Check, ChevronUp, Circle, Monitor, Smartphone, Tablet, TriangleAlert } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type { SiteBuilderDocument } from '../../model/types';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import { SCREEN_METADATA } from '../copy';
import type { OnboardingLabState, OnboardingScreenId } from '../model/types';
import { OnboardingSitePreview, type OnboardingPreviewDevice } from '../preview/OnboardingSitePreview';
import {
  getBuilderPrimaryLabel,
  getNeedsAttentionItems,
  getReadinessItems,
  type ReadinessStatus,
} from '../progress/readiness';

const STATUS_LABELS: Record<ReadinessStatus, string> = {
  needs_attention: 'Needs attention',
  optional: 'Optional',
  ready: 'Ready',
  recommended: 'Recommended',
};

const STATUS_ICONS = {
  needs_attention: TriangleAlert,
  optional: Circle,
  ready: Check,
  recommended: Circle,
} as const;

type FinalReviewScreenProps = {
  document: SiteBuilderDocument | null;
  onBack: () => void;
  onEdit: (screen: OnboardingScreenId) => void;
  onOpenBuilder: () => void;
  state: OnboardingLabState;
};

export function FinalReviewScreen({
  document,
  onBack,
  onEdit,
  onOpenBuilder,
  state,
}: FinalReviewScreenProps) {
  const readinessContentId = useId();
  const [device, setDevice] = useState<OnboardingPreviewDevice>('phone');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const readiness = useMemo(() => getReadinessItems(state, document), [document, state]);
  const needsAttention = useMemo(() => getNeedsAttentionItems(state, document), [document, state]);
  const primaryLabel = getBuilderPrimaryLabel(state, document);
  const handlePrimary = () => {
    const first = needsAttention.find((item) => item.screen);
    if (first?.screen) {
      onEdit(first.screen);
      return;
    }
    onOpenBuilder();
  };

  return (
    <div className="onboarding-screen onboarding-screen--review" data-screen="final_preview">
      <header className="onboarding-screen-heading">
        <h1>{SCREEN_METADATA.final_preview.heading}</h1>
        <p>{SCREEN_METADATA.final_preview.supportingCopy}</p>
      </header>
      <div aria-label="Preview device" className="onboarding-device-switcher" role="group">
        <button aria-pressed={device === 'phone'} type="button" onClick={() => setDevice('phone')}><Smartphone aria-hidden="true" size={17} /> Phone</button>
        <button aria-pressed={device === 'tablet'} type="button" onClick={() => setDevice('tablet')}><Tablet aria-hidden="true" size={17} /> Tablet</button>
        <button aria-pressed={device === 'desktop'} type="button" onClick={() => setDevice('desktop')}><Monitor aria-hidden="true" size={17} /> Desktop</button>
      </div>
      <div className="onboarding-review-layout">
        <OnboardingSitePreview device={device} document={document} label={`Final ${device} customer preview`} state={state} />
        <aside className={`onboarding-readiness${drawerOpen ? ' is-open' : ''}`} aria-label="Site readiness">
          <button aria-controls={readinessContentId} aria-expanded={drawerOpen} className="onboarding-readiness__mobile-trigger" type="button" onClick={() => setDrawerOpen((current) => !current)}>
            <span><strong>Site readiness</strong><small>{needsAttention.length === 0 ? 'Ready to open' : `${needsAttention.length} to review`}</small></span>
            <ChevronUp aria-hidden="true" size={18} />
          </button>
          <div className="onboarding-readiness__content" id={readinessContentId}>
            <h2>Site readiness</h2>
            <p>No percentage score—just what is ready and what you may want to revisit.</p>
            <ul>
              {readiness.map((item) => {
                const Icon = STATUS_ICONS[item.status];
                const editScreen = item.screen;
                return (
                  <li data-status={item.status} key={item.id}>
                    <Icon aria-hidden="true" size={16} />
                    <div><small>{STATUS_LABELS[item.status]}</small><strong>{item.label}</strong>{item.detail ? <p>{item.detail}</p> : null}</div>
                    {editScreen && item.status !== 'ready' ? <button aria-label={`Edit ${item.label}`} type="button" onClick={() => onEdit(editScreen)}>Edit</button> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
      <StickyOnboardingActions backLabel="Back" primaryLabel={primaryLabel} skipLabel="Edit setup" onBack={onBack} onPrimary={handlePrimary} onSkip={() => onEdit(needsAttention.find((item) => item.screen)?.screen ?? 'business')} />
    </div>
  );
}
