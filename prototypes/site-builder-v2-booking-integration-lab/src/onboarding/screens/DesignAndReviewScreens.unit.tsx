import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { initializeStarter } from '../../model';
import { createDanielaFixtureState } from '../fixtures';
import { goForward } from '../model/routing';
import type { OnboardingLabState } from '../model/types';
import {
  AboutDesignScreen,
  AboutScreen,
  SiteStyleScreen,
  type OnboardingStateUpdater,
} from './DesignScreens';
import { FinalReviewScreen } from './ReviewScreen';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

const aboutState = (): OnboardingLabState => {
  const state = createDanielaFixtureState();
  state.progress.currentScreen = 'about';
  state.progress.lastActiveScreen = 'about';
  state.progress.screenHistory = ['welcome', 'about'];
  state.progress.visitedScreens = ['welcome', 'about'];
  return state;
};

describe('About onboarding screens', () => {
  it('preserves disabled About data and conditionally routes straight to Policies', async () => {
    const user = userEvent.setup();
    const initial = aboutState();
    const preservedBio = initial.profile.about.shortBio;

    function Harness() {
      const [state, setState] = useState(initial);
      if (state.progress.currentScreen !== 'about') {
        return <output aria-label="Current onboarding screen">{state.progress.currentScreen}</output>;
      }
      return (
        <AboutScreen
          onBack={vi.fn()}
          onContinue={() => setState((current) => goForward(current))}
          onUpdate={setState}
          state={state}
        />
      );
    }

    render(<Harness />);
    const bio = screen.getByRole('textbox', { name: 'Short bio' });
    expect(bio).toHaveValue(preservedBio);

    await user.click(screen.getByRole('switch', { name: 'Include an About section' }));
    expect(screen.getByText(/About section is not shown on your site/i)).toBeVisible();
    expect(bio).toBeDisabled();
    expect(bio).toHaveValue(preservedBio);

    await user.click(screen.getByRole('button', { name: 'Continue without About' }));
    expect(screen.getByRole('status', { name: 'Current onboarding screen' })).toHaveTextContent('policies');
    expect(screen.queryByText('about_design')).not.toBeInTheDocument();
  });

  it('switches About layouts without changing the shared Business Profile content', async () => {
    const user = userEvent.setup();
    const initial = aboutState();
    initial.progress.currentScreen = 'about_design';
    initial.recipe.aboutPreset = 'photo_right';
    const originalProfile = structuredClone(initial.profile);
    let latestState = initial;

    function Harness() {
      const [state, setState] = useState(initial);
      const update: OnboardingStateUpdater = (transform) => setState((current) => {
        const next = transform(current);
        latestState = next;
        return next;
      });
      return (
        <AboutDesignScreen
          document={null}
          onBack={vi.fn()}
          onContinue={vi.fn()}
          onUpdate={update}
          state={state}
        />
      );
    }

    const { container } = render(<Harness />);
    const preview = screen.getByRole('region', { name: 'Selected About design preview' });
    expect(within(preview).getByText(originalProfile.about.shortBio)).toBeVisible();
    expect(within(preview).getByText('@islanail.studio')).toBeVisible();
    expect(container.querySelector('.onboarding-customer-about.is-photo-right')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Editorial Portrait/ }));
    expect(container.querySelector('.onboarding-customer-about.is-editorial')).toBeInTheDocument();
    expect(within(preview).getByText(originalProfile.about.fullBio)).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Profile \+ Quick Facts/ }));
    expect(container.querySelector('.onboarding-customer-about.is-quick-facts')).toBeInTheDocument();
    expect(within(preview).getByText(originalProfile.about.shortBio)).toBeVisible();
    expect(latestState.profile).toEqual(originalProfile);
    expect(screen.queryByRole('textbox', { name: /bio/i })).not.toBeInTheDocument();
  });
});

describe('SiteStyleScreen', () => {
  it('updates only customer-site roles and explicitly confirms the selected style', async () => {
    const user = userEvent.setup();
    const initial = createDanielaFixtureState();
    initial.recipe.styleConfirmed = false;
    initial.recipe.stylePreset = 'modern';
    let latestState = initial;

    function Harness() {
      const [state, setState] = useState(initial);
      const update: OnboardingStateUpdater = (transform) => setState((current) => {
        const next = transform(current);
        latestState = next;
        return next;
      });
      const confirm = () => update((current) => ({
        ...current,
        recipe: { ...current.recipe, styleConfirmed: true },
      }));
      return (
        <SiteStyleScreen
          document={null}
          onBack={vi.fn()}
          onContinue={confirm}
          onFullPreview={vi.fn()}
          onKeepCurrent={confirm}
          onUpdate={update}
          state={state}
        />
      );
    }

    const { container } = render(<Harness />);
    const preview = screen.getByRole('region', { name: 'Live personalized style preview' });
    expect(within(preview).getAllByText('Isla Nail Studio').length).toBeGreaterThan(0);
    expect(preview).toHaveAttribute('data-style-preset', 'modern');
    const ownerSurface = container.querySelector('.onboarding-screen--style');
    expect(ownerSurface).toBeInTheDocument();
    expect(ownerSurface).not.toHaveAttribute('data-style-preset');

    await user.click(screen.getByRole('button', { name: /Luxury/ }));
    expect(preview).toHaveAttribute('data-style-preset', 'luxury');
    expect(latestState.recipe.styleConfirmed).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Use this style' }));
    expect(latestState.recipe).toMatchObject({
      styleConfirmed: true,
      stylePreset: 'luxury',
    });
  });

  it('allows the bounded default style to be accepted explicitly', async () => {
    const user = userEvent.setup();
    const initial = createDanielaFixtureState();
    initial.recipe.styleConfirmed = false;
    initial.recipe.stylePreset = 'modern';
    let confirmed = false;
    render(
      <SiteStyleScreen
        document={null}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onFullPreview={vi.fn()}
        onKeepCurrent={() => { confirmed = true; }}
        onUpdate={vi.fn()}
        state={initial}
      />,
    );

    expect(screen.getByRole('button', { name: /Modern/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Keep current style' }));
    expect(confirmed).toBe(true);
  });
});

describe('FinalReviewScreen', () => {
  it('returns incomplete essentials to edit instead of opening Builder', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.recipe.styleConfirmed = false;
    const document = initializeStarter('one_page', {
      siteId: state.recipe.starterDocumentSiteId ?? undefined,
      siteName: state.profile.businessName,
    });
    const onEdit = vi.fn();
    const onOpenBuilder = vi.fn();
    render(
      <FinalReviewScreen
        document={document}
        onBack={vi.fn()}
        onEdit={onEdit}
        onOpenBuilder={onOpenBuilder}
        state={state}
      />,
    );

    expect(screen.getByRole('button', { name: 'Finish 1 essential' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Site readiness' })).toHaveTextContent('Needs attentionSite style');
    await user.click(screen.getByRole('button', { name: 'Finish 1 essential' }));
    expect(onEdit).toHaveBeenCalledWith('site_style');
    expect(onOpenBuilder).not.toHaveBeenCalled();
  });

  it('enables the handoff only when essentials and the real Booking path are ready', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    const document = initializeStarter('one_page', {
      siteId: state.recipe.starterDocumentSiteId ?? undefined,
      siteName: state.profile.businessName,
    });
    const onOpenBuilder = vi.fn();
    render(
      <FinalReviewScreen
        document={document}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onOpenBuilder={onOpenBuilder}
        state={state}
      />,
    );

    expect(screen.getByText('Booking path available')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open my Builder' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tablet' }));
    expect(screen.getByRole('region', { name: 'Final tablet customer preview' })).toHaveAttribute('data-preview-device', 'tablet');
    await user.click(screen.getByRole('button', { name: 'Open my Builder' }));
    expect(onOpenBuilder).toHaveBeenCalledOnce();
  });
});
