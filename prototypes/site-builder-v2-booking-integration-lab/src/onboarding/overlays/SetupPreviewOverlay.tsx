import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';

import type { SiteBuilderDocument } from '../../model/types';
import { Dialog } from '../../ui/Dialog';
import type { OnboardingLabState } from '../model/types';
import {
  OnboardingSitePreview,
  type OnboardingPreviewDevice,
} from '../preview/OnboardingSitePreview';

type SetupPreviewOverlayProps = {
  document: SiteBuilderDocument | null;
  onClose: () => void;
  onContinue: () => void;
  open: boolean;
  source: 'starting_preview' | 'site_style' | 'final_preview';
  state: OnboardingLabState;
};

export function SetupPreviewOverlay({
  document,
  onClose,
  onContinue,
  open,
  source,
  state,
}: SetupPreviewOverlayProps) {
  const [device, setDevice] = useState<OnboardingPreviewDevice>('phone');
  const title = source === 'starting_preview'
    ? 'Preview your starting site'
    : source === 'site_style'
      ? 'Preview your look'
      : 'Preview your site';

  return (
    <Dialog
      description="This is the customer experience. Builder controls and plan choices are not available here."
      onClose={onClose}
      open={open}
      title={title}
      variant="sheet"
    >
      <div className="onboarding-preview-overlay" data-preview-source={source}>
        <div aria-label="Preview device" className="onboarding-device-switcher" role="group">
          <button aria-pressed={device === 'phone'} type="button" onClick={() => setDevice('phone')}><Smartphone aria-hidden="true" size={17} /> Phone</button>
          <button aria-pressed={device === 'tablet'} type="button" onClick={() => setDevice('tablet')}><Tablet aria-hidden="true" size={17} /> Tablet</button>
          <button aria-pressed={device === 'desktop'} type="button" onClick={() => setDevice('desktop')}><Monitor aria-hidden="true" size={17} /> Desktop</button>
        </div>
        <OnboardingSitePreview
          device={device}
          document={document}
          includeOptionalSections={source !== 'starting_preview'}
          label={`${title} — ${device}`}
          state={state}
        />
        <footer className="onboarding-overlay-actions">
          <button type="button" onClick={onClose}>Back</button>
          <button className="is-primary" type="button" onClick={onContinue}>
            {source === 'starting_preview' ? 'Continue setup' : 'Return to setup'}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
