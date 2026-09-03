import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import type { SiteBuilderDocument } from '../../model/types';
import { Dialog } from '../../ui/Dialog';
import type { OnboardingLabState } from '../model/types';
import {
  OnboardingSitePreview,
  type OnboardingPreviewDevice,
  type OnboardingPreviewInitialTarget,
  type QuickBookPreviewPhase,
} from '../preview/OnboardingSitePreview';

type SetupPreviewOverlayProps = {
  document: SiteBuilderDocument | null;
  initialTarget?: OnboardingPreviewInitialTarget;
  onClose: () => void;
  onContinue: () => void;
  open: boolean;
  source: 'starting_preview' | 'about' | 'about_design' | 'booking_layout' | 'site_style' | 'final_preview';
  state: OnboardingLabState;
};

export function SetupPreviewOverlay({
  document,
  initialTarget,
  onClose,
  onContinue,
  open,
  source,
  state,
}: SetupPreviewOverlayProps) {
  const [device, setDevice] = useState<OnboardingPreviewDevice>('phone');
  const returnActionsId = useId();
  const returnActionsRef = useRef<HTMLElement>(null);
  const title = source === 'starting_preview'
    ? 'Preview your starting site'
    : source === 'booking_layout'
      ? 'Preview your booking layout'
    : source === 'about_design' && state.recipe.starter === 'quick_book'
      ? 'Preview your Quick Book layout'
    : source === 'about' || source === 'about_design'
      ? 'Preview your About section'
    : source === 'site_style'
      ? 'Preview your look'
      : 'Preview your site';
  const resolvedInitialTarget = initialTarget
    ?? (source === 'about'
      || (source === 'about_design' && state.recipe.starter !== 'quick_book')
      ? 'about'
      : 'top');
  const quickBookPhase: QuickBookPreviewPhase = source === 'starting_preview'
    ? 'identity'
    : source === 'site_style'
      ? 'business'
      : 'final';

  return (
    <Dialog
      description="This is the customer experience. Builder controls and plan choices are not available here."
      onClose={onClose}
      open={open}
      title={title}
      variant="sheet"
    >
      <div className="onboarding-preview-overlay" data-preview-source={source}>
        <a
          className="onboarding-preview-skip-link"
          href={`#${returnActionsId}`}
          onClick={(event) => {
            event.preventDefault();
            returnActionsRef.current?.scrollIntoView?.({ block: 'end', inline: 'nearest' });
            returnActionsRef.current?.focus({ preventScroll: true });
          }}
        >
          Skip preview content
        </a>
        <div aria-label="Preview device" className="onboarding-device-switcher" role="group">
          <button aria-pressed={device === 'phone'} type="button" onClick={() => setDevice('phone')}><Smartphone aria-hidden="true" size={17} /> Phone</button>
          <button aria-pressed={device === 'tablet'} type="button" onClick={() => setDevice('tablet')}><Tablet aria-hidden="true" size={17} /> Tablet</button>
          <button aria-pressed={device === 'desktop'} type="button" onClick={() => setDevice('desktop')}><Monitor aria-hidden="true" size={17} /> Desktop</button>
        </div>
        <OnboardingSitePreview
          device={device}
          document={document}
          fitAvailable
          includeOptionalSections={source !== 'starting_preview'}
          initialTarget={resolvedInitialTarget}
          interactionMode="interactive"
          label={`${title} — ${device}`}
          quickBookPhase={quickBookPhase}
          state={state}
        />
        <footer
          ref={returnActionsRef}
          className="onboarding-overlay-actions"
          id={returnActionsId}
          tabIndex={-1}
        >
          <button type="button" onClick={onClose}>Back</button>
          <button className="is-primary" type="button" onClick={onContinue}>
            {source === 'starting_preview' ? 'Continue setup' : 'Return to setup'}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
