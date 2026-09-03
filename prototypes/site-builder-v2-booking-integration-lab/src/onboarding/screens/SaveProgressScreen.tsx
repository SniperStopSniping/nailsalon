import {
  Cloud,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';

import type { SiteBuilderDocument } from '../../model/types';
import { SITE_PALETTE_BY_ID } from '../model/palettes';
import { getSiteStyleLabel } from '../model/site-styles';
import type { OnboardingLabState } from '../model/types';
import { OnboardingSitePreview } from '../preview/OnboardingSitePreview';

type SaveProgressScreenProps = {
  document: SiteBuilderDocument | null;
  onBack: () => void;
  onUnavailable: () => void;
  state: OnboardingLabState;
};

const benefits = [
  { icon: ShieldCheck, label: 'Fully secure' },
  { icon: Cloud, label: 'Save anytime' },
  { icon: Smartphone, label: 'Access anywhere' },
  { icon: LockKeyhole, label: 'Free to create' },
] as const;

export function SaveProgressScreen({
  document,
  onBack,
  onUnavailable,
  state,
}: SaveProgressScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const palette = SITE_PALETTE_BY_ID[state.recipe.palettePreset];

  useLayoutEffect(() => {
    if (window.document.scrollingElement) {
      window.document.scrollingElement.scrollTop = 0;
    }
    window.document.documentElement.scrollTop = 0;
    window.document.body.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="onboarding-save-progress" data-screen="save_progress">
      <header className="onboarding-save-progress__heading">
        <p className="onboarding-screen-kicker">Step 6 — Save your progress</p>
        <div>
          <Sparkles aria-hidden="true" size={24} />
          <h1 ref={headingRef} tabIndex={-1}>
            {'Your site is coming together '}
            <span aria-hidden="true">✨</span>
          </h1>
        </div>
        <p>Create your free Luster account to save your progress and keep building your online booking site.</p>
      </header>

      <section className="onboarding-save-progress__reward" aria-label="The site you have created so far">
        <div
          aria-label={`${state.profile.businessName || 'Your site'} preview in ${getSiteStyleLabel(state.recipe.stylePreset)} with ${palette.label}`}
          className="onboarding-save-progress__preview"
        >
          <OnboardingSitePreview
            document={document}
            fitAvailable
            interactionMode="scrollable"
            label="Your personalized website preview"
            quickBookPhase="business"
            state={state}
          />
          <span aria-hidden="true" className="onboarding-save-progress__swipe-hint">Swipe to explore</span>
        </div>
      </section>

      <ul className="onboarding-save-progress__benefits" aria-label="Account benefits">
        {benefits.map(({ icon: Icon, label }) => (
          <li key={label}>
            <Icon aria-hidden="true" size={20} />
            <span>{label}</span>
          </li>
        ))}
      </ul>

      <section className="onboarding-save-progress__account" aria-labelledby="save-account-heading">
        <h2 id="save-account-heading">Create your free account</h2>
        <p>No payment required. You can change everything later.</p>
        <button type="button" onClick={onUnavailable}>
          <span className="onboarding-provider-letter" aria-hidden="true">G</span>
          Continue with Google
        </button>
        <button type="button" onClick={onUnavailable}>
          <span className="onboarding-provider-apple" aria-hidden="true">●</span>
          Continue with Apple
        </button>
        <button type="button" onClick={onUnavailable}>
          <Mail aria-hidden="true" size={20} />
          Continue with email
        </button>
        <p className="onboarding-save-progress__login">
          {'Already have an account? '}
          <button type="button" onClick={onUnavailable}>Log in</button>
        </p>
        <p className="onboarding-save-progress__local-note">Account saving opens on Luster’s connected app. Your local preview is still safe on this device.</p>
      </section>

      <footer className="onboarding-save-progress__footer">
        <button type="button" onClick={onBack}>← Back</button>
        <p className="onboarding-save-progress__reassure">
          <LockKeyhole aria-hidden="true" size={15} />
          {' '}
          Free to create · No payment required
        </p>
      </footer>
    </div>
  );
}
