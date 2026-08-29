import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { initializeStarter } from '../../model';
import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
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

const reviewMocks = vi.hoisted(() => ({
  assetMap: new Map<string, unknown>(),
}));

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => reviewMocks.assetMap,
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
          onFullPreview={vi.fn()}
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
          onFullPreview={vi.fn()}
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
    expect(within(preview).getByText(originalProfile.about.fullBio)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Profile \+ Quick Facts/ }));
    expect(container.querySelector('.onboarding-customer-about.is-quick-facts')).toBeInTheDocument();
    expect(within(preview).getByText(originalProfile.about.shortBio)).toBeVisible();
    expect(latestState.profile).toEqual(originalProfile);
    expect(screen.queryByRole('textbox', { name: /bio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Previous About design/u }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next About design/u }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Content' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'About design presets' }))
      .getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(screen.getByText('✓ Selected')).toBeVisible();
  });

  it('keeps the shared Instagram independently available while contact is Booking-only', async () => {
    const user = userEvent.setup();
    const initial = aboutState();
    initial.profile.bookingOnlyContact = true;
    initial.profile.about.visibility.instagram = true;

    render(
      <AboutScreen
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onFullPreview={vi.fn()}
        onUpdate={vi.fn()}
        state={initial}
      />,
    );

    await user.click(screen.getByText('Details from your setup'));
    const instagram = screen.getByRole('switch', {
      name: 'Show Instagram in About',
    });
    expect(instagram).toBeChecked();
    expect(instagram).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Instagram handle' }))
      .toHaveValue('@islanail.studio');
    expect(within(screen.getByRole('region', { name: 'About section live preview' }))
      .getByText('@islanail.studio')).toBeVisible();
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
    expect(preview.querySelector('[data-style-preset]')).toHaveAttribute(
      'data-style-preset',
      'modern',
    );
    const ownerSurface = container.querySelector('.onboarding-screen--style');
    expect(ownerSurface).toBeInTheDocument();
    expect(ownerSurface).not.toHaveAttribute('data-style-preset');
    expect(screen.getByText('On your site now')).toBeVisible();
    expect(screen.getAllByText('Previewing')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Luxury/ }));
    expect(preview.querySelector('[data-style-preset]')).toHaveAttribute(
      'data-style-preset',
      'luxury',
    );
    expect(latestState.recipe.styleConfirmed).toBe(false);
    expect(within(screen.getByRole('group', { name: 'Site style presets' }))
      .getByRole('button', { name: /Luxury/ })).toHaveAttribute(
      'data-previewing',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Use Luxury' }));
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
    const onContinue = vi.fn();
    render(
      <SiteStyleScreen
        document={null}
        onBack={vi.fn()}
        onContinue={onContinue}
        onFullPreview={vi.fn()}
        onUpdate={vi.fn()}
        state={initial}
      />,
    );

    expect(within(screen.getByRole('group', { name: 'Site style presets' }))
      .getByRole('button', { name: /Modern/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(
      'Your pages, photos and information stay the same — only the style changes.',
    )).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Keep current style' }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use Modern' }));
    expect(onContinue).toHaveBeenCalledOnce();
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
        onEditCanva={vi.fn()}
        onOpenBuilder={onOpenBuilder}
        onOpenPreview={vi.fn()}
        state={state}
      />,
    );

    expect(screen.getByRole('button', { name: 'Finish 1 required step' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Site readiness' })).toHaveTextContent('Needs attentionSite style');
    await user.click(screen.getByRole('button', { name: 'Finish 1 required step' }));
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
        onEditCanva={vi.fn()}
        onOpenBuilder={onOpenBuilder}
        onOpenPreview={vi.fn()}
        state={state}
      />,
    );

    expect(screen.getByText('Clients can book you')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit Clients can book you' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit Business information' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit Contact and privacy' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit Looks right on a phone' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tablet' }));
    expect(screen.getByRole('region', { name: 'Final tablet customer preview' })).toHaveAttribute('data-preview-device', 'tablet');
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(onOpenBuilder).toHaveBeenCalledOnce();
  });

  it('opens mobile readiness on first entry and becomes inert only after the owner collapses it', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      matches: query === '(max-width: 919px)',
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    const state = createDanielaFixtureState();
    const document = initializeStarter('one_page');
    render(
      <FinalReviewScreen
        document={document}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onEditCanva={vi.fn()}
        onOpenBuilder={vi.fn()}
        onOpenPreview={vi.fn()}
        state={state}
      />,
    );
    const readiness = screen.getByRole('complementary', { name: 'Site readiness' });
    const detail = within(readiness).getByText(/Your website is saved/u)
      .closest<HTMLElement>('.onboarding-readiness__content');
    if (!detail) throw new Error('Missing readiness detail panel.');
    await waitFor(() => expect(detail.inert).toBe(false));
    expect(detail).not.toHaveAttribute('aria-hidden');

    await userEvent.setup().click(screen.getByRole('button', { name: /Site readiness/u }));
    await waitFor(() => expect(detail.inert).toBe(true));
    expect(detail).toHaveAttribute('aria-hidden', 'true');
    matchMedia.mockRestore();
  });

  it('opens the real Canva repair flow for a missing uploaded page', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    const document = initializeStarter('one_page');
    document.pages[0]!.sections.push({
      id: 'custom-missing',
      label: 'Canva design',
      order: 99,
      sectionType: 'custom_design',
      settings: {
        ...createDefaultCustomDesignSettings(),
        images: [{
          altText: '',
          aspectRatio: 0.75,
          assetId: 'asset-missing',
          decorative: false,
          fileName: 'missing-page.png',
          fileSize: 100,
          height: 1_600,
          id: 'image-missing',
          interactiveAreas: [],
          mimeType: 'image/png',
          width: 1_200,
        }],
      },
      visible: true,
    });
    reviewMocks.assetMap = new Map([['asset-missing', {
      original: {
        assetId: 'asset-missing',
        error: new Error('Missing'),
        kind: 'original',
        status: 'unavailable',
      },
      thumbnail: {
        assetId: 'asset-missing',
        error: new Error('Missing'),
        kind: 'thumbnail',
        status: 'unavailable',
      },
    }]]);
    const onEdit = vi.fn();
    const onEditCanva = vi.fn();
    render(
      <FinalReviewScreen
        document={document}
        onBack={vi.fn()}
        onEdit={onEdit}
        onEditCanva={onEditCanva}
        onOpenBuilder={vi.fn()}
        onOpenPreview={vi.fn()}
        state={state}
      />,
    );

    await user.click(screen.getByRole('button', {
      name: 'Replace missing-page.png needs attention',
    }));
    expect(onEditCanva).toHaveBeenCalledOnce();
    expect(onEdit).not.toHaveBeenCalled();
    reviewMocks.assetMap = new Map();
  });
});
