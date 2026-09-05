import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react';
import { vi } from 'vitest';

import { initializeStarter } from '../../model';
import { createDanielaFixtureState } from '../fixtures';
import { OnboardingSitePreview } from '../preview/OnboardingSitePreview';
import { SaveProgressScreen } from './SaveProgressScreen';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

const createScreenSixState = () => {
  const state = createDanielaFixtureState();
  state.recipe.starter = 'quick_book';
  state.recipe.stylePreset = 'modern';
  state.recipe.palettePreset = 'luster_berry';
  state.profile.businessName = 'Isla Nail';
  state.profile.ownerName = 'Daniela';
  state.profile.instagram = '@Isla_nails';
  state.profile.location.cityOrArea = 'Toronto';
  state.profile.location.exactAddress = '880 Ellesmere Rd';
  state.profile.location.addressVisibility = 'after_booking';
  state.profile.bookingOnlyContact = true;
  state.profile.hours.showOnSite = true;
  return state;
};

const publicFacts = (root: ParentNode): string[] => Array.from(
  root.querySelectorAll<HTMLElement>('[data-content-key]'),
).map(element => `${element.dataset.contentKey}:${element.textContent?.replace(/\s+/gu, ' ').trim()}`);

const quickBookProfileText = (root: ParentNode): string => root
  .querySelector<HTMLElement>('.onboarding-quick-book-profile')
  ?.textContent?.replace(/\s+/gu, ' ')
  .trim() ?? '';

describe('progressive customer-site previews through Screen 6', () => {
  it('opens the standalone Screen 6 reward at the top', () => {
    document.documentElement.scrollTop = 325;
    document.body.scrollTop = 325;

    render(
      <SaveProgressScreen
        document={initializeStarter('quick_book')}
        onBack={vi.fn()}
        onUnavailable={vi.fn()}
        state={createScreenSixState()}
      />,
    );

    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
  });

  it('keeps Preview 1 to public Screen 1 identity and the existing Booking section', () => {
    const state = createScreenSixState();
    const document = initializeStarter('quick_book');
    const view = render(
      <OnboardingSitePreview
        document={document}
        interactionMode="interactive"
        label="Screen 2 first preview"
        quickBookPhase="identity"
        state={state}
      />,
    );
    const stage = view.container.querySelector<HTMLElement>('.onboarding-preview-stage')!;
    const profile = stage.querySelector<HTMLElement>('.onboarding-quick-book-profile')!;

    expect(profile).toHaveAttribute('data-preview-phase', 'identity');
    expect(profile).toHaveTextContent('Isla Nail');
    expect(profile).toHaveTextContent('Daniela');
    expect(profile).toHaveTextContent('@Isla_nails');
    expect(stage.querySelectorAll('[aria-label="Booking"]')).toHaveLength(1);
    expect(profile.querySelector('[data-quick-book-fact]')).toBeNull();
    expect(profile.querySelector('.onboarding-quick-book-profile__contacts')).toBeNull();
    expect(stage).not.toHaveTextContent('Toronto');
    expect(stage).not.toHaveTextContent('880 Ellesmere Rd');
    expect(stage).not.toHaveTextContent(/Open now|Closed · Opens|Opens tomorrow/u);
    expect(stage).not.toHaveTextContent('Online booking only');
    expect(stage).not.toHaveTextContent('About Daniela');
    expect(stage).not.toHaveTextContent('Before you book');
    expect(stage.querySelector('.customer-lib-visit')).toBeNull();
  });

  it('renders privacy-safe business information through Screen 5 without later content', () => {
    const state = createScreenSixState();
    const document = initializeStarter('quick_book');
    const view = render(
      <OnboardingSitePreview
        document={document}
        interactionMode="interactive"
        label="Screen 5 full preview"
        quickBookPhase="business"
        state={state}
      />,
    );
    const stage = view.container.querySelector<HTMLElement>('.onboarding-preview-stage')!;

    expect(stage).toHaveTextContent('Isla Nail');
    expect(stage).toHaveTextContent('Daniela');
    expect(stage).toHaveTextContent('@Isla_nails');
    expect(stage).toHaveTextContent('Toronto');
    expect(stage).toHaveTextContent('Exact address shared after booking.');
    expect(stage).not.toHaveTextContent('880 Ellesmere Rd');
    expect(stage).toHaveTextContent(/Open now|Closed/u);
    expect(stage).toHaveTextContent('Online booking only');
    expect(stage).toHaveTextContent('Book an appointment');
    expect(stage).not.toHaveTextContent('About Daniela');
    expect(stage).not.toHaveTextContent('Before you book');
    expect(stage.querySelector('.customer-lib-visit')).toBeNull();
    expect(stage.querySelector('[data-style-preset]')).toHaveAttribute('data-style-preset', 'modern');
    expect(stage.querySelector('[data-palette-preset]')).toHaveAttribute('data-palette-preset', 'luster_berry');
  });

  it('uses the same public facts in the Screen 5 full preview and Screen 6 reward preview', () => {
    const state = createScreenSixState();
    const document = initializeStarter('quick_book');
    const full = render(
      <OnboardingSitePreview
        document={document}
        interactionMode="interactive"
        label="Screen 5 full preview"
        quickBookPhase="business"
        state={state}
      />,
    );
    const expected = publicFacts(full.container);
    const expectedProfile = quickBookProfileText(full.container);
    full.unmount();

    const reward = render(
      <SaveProgressScreen
        document={document}
        onBack={vi.fn()}
        onUnavailable={vi.fn()}
        state={state}
      />,
    );
    const preview = reward.container.querySelector<HTMLElement>('.onboarding-save-progress__preview')!;

    expect(publicFacts(preview)).toEqual(expected);
    expect(quickBookProfileText(preview)).toBe(expectedProfile);
    expect(preview.querySelector('.onboarding-preview-stage'))
      .toHaveAttribute('data-preview-interaction', 'scrollable');
    expect(preview.querySelector<HTMLElement>('.onboarding-preview-frame')?.inert).toBe(false);
    expect(preview.querySelector<HTMLElement>('.onboarding-site-preview')?.inert).toBe(true);
    expect(preview).toHaveTextContent('Swipe to explore');
  });

  it('keeps the reward viewport touch-scrollable without blocking the outer page', () => {
    const onboardingCss = readFileSync(join(process.cwd(), 'src/onboarding/onboarding.css'), 'utf8');
    const screenCss = readFileSync(join(process.cwd(), 'src/onboarding/style-colours-save.css'), 'utf8');

    expect(onboardingCss).toMatch(
      /data-preview-interaction="scrollable"[^}]*\.onboarding-preview-frame \{[^}]*overscroll-behavior-y: auto;[^}]*touch-action: pan-y;/u,
    );
    expect(onboardingCss).toMatch(
      /\.onboarding-preview-stage\.is-fit-available \.onboarding-preview-measurement-host \{[^}]*height: 100%;/u,
    );
    expect(screenCss).toMatch(
      /\.onboarding-look-preview__frame \{[^}]*pointer-events: none;/u,
    );
    expect(screenCss).not.toMatch(
      /\.onboarding-save-progress__preview \{[^}]*pointer-events: none;/u,
    );
  });
});
