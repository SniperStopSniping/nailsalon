import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, vi } from 'vitest';

import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
import { initializeStarter } from '../../model';
import { createDanielaFixtureState } from '../fixtures';
import { goForward } from '../model/routing';
import type { OnboardingLabState } from '../model/types';
import {
  AboutDesignScreen,
  AboutScreen,
  type OnboardingStateUpdater,
  SiteStyleScreen,
} from './DesignScreens';
import { FinalReviewScreen } from './ReviewScreen';

const reviewMocks = vi.hoisted(() => ({
  assetMap: new Map<string, unknown>(),
}));

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => reviewMocks.assetMap,
}));

const useShortPhoneViewport = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: query === '(max-width: 479px) and (max-height: 700px)',
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const aboutState = (): OnboardingLabState => {
  const state = createDanielaFixtureState();
  state.progress.currentScreen = 'about';
  state.progress.lastActiveScreen = 'about';
  state.progress.screenHistory = ['welcome', 'about'];
  state.progress.visitedScreens = ['welcome', 'about'];
  return state;
};

describe('About onboarding screens', () => {
  it('keeps Use this design visually primary and Back to edit About secondary', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/onboarding/daniela-about-style.css'),
      'utf8',
    );

    expect(css).toMatch(
      /data-screen="about_design"[\s\S]*?button\.sticky-onboarding-actions__primary \{[^}]*width: 100%;[^}]*grid-column: 1 \/ -1;[^}]*background: var\(--onboarding-accent\);/u,
    );
    expect(css).toMatch(
      /data-screen="about_design"[\s\S]*?button\.sticky-onboarding-actions__back \{[^}]*width: auto;[^}]*justify-self: start;[^}]*background: var\(--onboarding-surface\);/u,
    );
  });

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
          onContinue={() => setState(current => goForward(current))}
          onFullPreview={vi.fn()}
          onUpdate={setState}
          state={state}
        />
      );
    }

    render(<Harness />);
    const bio = screen.getByRole('textbox', { name: 'Short introduction' });

    expect(bio).toHaveValue(preservedBio);

    await user.click(screen.getByRole('switch', { name: 'Show an About section' }));

    expect(screen.queryByRole('textbox', { name: 'Short introduction' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

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
      const update: OnboardingStateUpdater = transform => setState((current) => {
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
    const presets = within(screen.getByRole('group', { name: 'About design presets' }));
    const presetGroup = presets.getAllByRole('button');
    const preview = screen.getByRole('region', {
      name: 'Selected About design preview: Photo Right',
    });

    expect(presetGroup).toHaveLength(4);
    expect(Boolean(
      (presetGroup[3]?.compareDocumentPosition(preview) ?? 0)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    )).toBe(true);
    expect(Boolean(
      screen.getByRole('heading', { name: 'See it on your site' })
        .compareDocumentPosition(preview)
        & Node.DOCUMENT_POSITION_FOLLOWING,
    )).toBe(true);

    const inlineFrame = preview.querySelector<HTMLElement>('.onboarding-preview-frame');

    expect(inlineFrame?.inert).toBe(true);
    expect(inlineFrame).toHaveAttribute('tabindex', '-1');
    expect(within(preview).getByText(originalProfile.about.shortBio)).toBeVisible();
    expect(within(preview).queryByText('@islanail.studio')).not.toBeInTheDocument();
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

    const selectedPreset = presets.getAllByRole('button', { pressed: true });

    expect(selectedPreset).toHaveLength(1);
    expect(within(selectedPreset[0]!).getByText('Selected')).toBeVisible();

    const tabOrder = Array.from(container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).map(element => element.textContent?.trim());

    expect(tabOrder.indexOf('Open interactive preview'))
      .toBeLessThan(tabOrder.indexOf('Use this design'));
    expect(tabOrder.indexOf('Use this design'))
      .toBeLessThan(tabOrder.indexOf('Back to edit About'));
  });

  it('keeps Instagram in the saved profile without creating another About input', () => {
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

    expect(initial.profile.instagram).toBe('@islanail.studio');
    expect(screen.queryByRole('textbox', { name: /Instagram/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Show Instagram in About' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'About section live preview' }))
      .not.toBeInTheDocument();
  });

  it('routes Edit profile to the canonical Screen 1 identity instead of duplicating it', async () => {
    const user = userEvent.setup();
    const initial = aboutState();
    const onEditProfile = vi.fn();

    render(
      <AboutScreen
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onEditProfile={onEditProfile}
        onFullPreview={vi.fn()}
        onUpdate={vi.fn()}
        state={initial}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));

    expect(onEditProfile).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox', { name: /Instagram/i })).not.toBeInTheDocument();
  });
});

describe('SiteStyleScreen', () => {
  it('keeps six mobile styles in a visible two-column grid with compact descriptions', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/onboarding/daniela-about-style.css'),
      'utf8',
    );

    expect(css).toMatch(
      /\.onboarding-screen--style \.onboarding-style-grid \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*overflow: visible;/u,
    );
    expect(css).toMatch(
      /\.onboarding-screen--style \.onboarding-style-card > small \{[^}]*-webkit-line-clamp: 2;/u,
    );
    expect(css).not.toContain('scroll-snap-type: inline mandatory');
  });

  it('keeps physical-phone About spacing distinct between actions, facts, and major groups', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/onboarding/daniela-about-style.css'),
      'utf8',
    );

    expect(css).toMatch(/\.onboarding-about-facts \{[^}]*gap: 10px;/u);
    expect(css).toMatch(
      /\.onboarding-customer-about \.onboarding-customer-actions \{[^}]*gap: 12px;[^}]*margin-top: 16px;/u,
    );
    expect(css).toMatch(
      /@container onboarding-preview \(max-width: 559px\) \{[\s\S]*?\.onboarding-customer-about \{[^}]*gap: 20px;/u,
    );
  });

  it('progressively discloses style and colour choices on short phones', async () => {
    useShortPhoneViewport();
    const user = userEvent.setup();
    const initial = createDanielaFixtureState();

    function Harness() {
      const [state, setState] = useState(initial);
      return (
        <SiteStyleScreen
          document={null}
          onBack={vi.fn()}
          onContinue={vi.fn()}
          onFullPreview={vi.fn()}
          onUpdate={setState}
          state={state}
        />
      );
    }

    render(<Harness />);

    expect(screen.queryByRole('group', { name: 'Site style presets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Website colour palettes' }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change website style' }));
    const styles = screen.getByRole('group', { name: 'Site style presets' });

    expect(within(styles).getAllByRole('button')).toHaveLength(6);

    await user.click(within(styles).getByRole('button', { name: /Luxury/u }));
    await user.click(screen.getByRole('button', { name: 'Done website style' }));

    expect(screen.queryByRole('group', { name: 'Site style presets' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change website colours' }));
    const palettes = screen.getByRole('group', { name: 'Website colour palettes' });

    expect(within(palettes).getAllByRole('button')).toHaveLength(8);

    await user.click(within(palettes).getByRole('button', { name: /Black & Champagne/u }));

    expect(screen.getByRole('button', { name: 'Done website colours' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the two portrait-led About presets beside the introduction on phones', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/onboarding/daniela-about-style.css'),
      'utf8',
    );

    expect(css).toMatch(
      /@container onboarding-preview \(max-width: 559px\) \{[\s\S]*?\.onboarding-customer-about\.is-photo-right\.has-portrait \{[^}]*grid-template-columns: minmax\(0, 1fr\) clamp\(96px, 30cqw, 124px\);/u,
    );
    expect(css).toMatch(
      /\.onboarding-customer-about\.is-photo-right > \.onboarding-customer-portrait\.is-large \{[^}]*grid-column: 2;[^}]*aspect-ratio: 4 \/ 5;/u,
    );
    expect(css).toMatch(
      /\.onboarding-customer-about\.is-editorial\.has-portrait \{[^}]*grid-template-columns: clamp\(104px, 33cqw, 136px\) minmax\(0, 1fr\);/u,
    );
    expect(css).toMatch(
      /\.onboarding-customer-about\.is-editorial\.has-portrait > \.onboarding-customer-portrait\.is-large \{[^}]*grid-column: 1;[^}]*aspect-ratio: 4 \/ 5;/u,
    );
    expect(css).not.toMatch(
      /@container onboarding-preview \(max-width: 559px\) \{[\s\S]*?\.onboarding-customer-about\.is-photo-right > \.onboarding-customer-portrait\.is-large \{[^}]*order: -1;/u,
    );
  });

  it('updates only customer-site roles and explicitly confirms the selected style', async () => {
    const user = userEvent.setup();
    const initial = createDanielaFixtureState();
    initial.recipe.styleConfirmed = false;
    initial.recipe.stylePreset = 'modern';
    let latestState = initial;

    function Harness() {
      const [state, setState] = useState(initial);
      const update: OnboardingStateUpdater = transform => setState((current) => {
        const next = transform(current);
        latestState = next;
        return next;
      });
      const confirm = () => update(current => ({
        ...current,
        recipe: {
          ...current.recipe,
          paletteConfirmed: true,
          styleConfirmed: true,
        },
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
    expect(preview.querySelector('[data-palette-preset]')).toHaveAttribute(
      'data-palette-preset',
      'blush_cocoa',
    );

    const ownerSurface = container.querySelector('.onboarding-screen--style');

    expect(ownerSurface).toBeInTheDocument();
    expect(ownerSurface).not.toHaveAttribute('data-style-preset');
    expect(screen.getAllByText('Previewing')).toHaveLength(2);
    expect(within(screen.getByRole('group', { name: 'Website colour palettes' }))
      .getAllByRole('button')).toHaveLength(8);
    expect(screen.getByRole('region', { name: 'Live personalized style preview' })).toBeVisible();

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

    await user.click(screen.getByRole('button', { name: /Black & Champagne/ }));

    expect(preview.querySelector('[data-palette-preset]')).toHaveAttribute(
      'data-palette-preset',
      'black_champagne',
    );
    expect(latestState.recipe.paletteConfirmed).toBe(false);
    expect(within(screen.getByRole('group', { name: 'Website colour palettes' }))
      .getByRole('button', { name: /Black & Champagne/ })).toHaveAttribute(
      'data-previewing',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Use this look' }));

    expect(latestState.recipe).toMatchObject({
      paletteConfirmed: true,
      palettePreset: 'black_champagne',
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
    expect(screen.getByText('Choose a style and colours for your site. You can change them anytime.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Keep current style' }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use this look' }));

    expect(onContinue).toHaveBeenCalledOnce();
  });
});

describe('FinalReviewScreen', () => {
  it('keeps disabled optional sections out of the provided-document customer preview', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutEnabled = false;
    state.recipe.galleryEnabled = false;
    state.recipe.policiesEnabled = false;
    const document = initializeStarter('one_page');
    const excludedIds = document.pages.flatMap(page => page.sections)
      .filter(section => [
        'about',
        'deposits_cancellations',
        'gallery',
        'policies',
      ].includes(section.sectionType))
      .map(section => section.id);

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

    const preview = screen.getByRole('region', {
      name: 'Final phone customer preview',
    });
    for (const sectionId of excludedIds) {
      expect(preview.querySelector(`[data-section-id="${sectionId}"]`))
        .not.toBeInTheDocument();
    }
  });

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
    expect(screen.getByLabelText('Selected website design'))
      .toHaveTextContent('Website styleSoftColoursBlush & Cocoa');
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

  it('uses truthful account-save copy for the integrated Final Review', () => {
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
        primaryActionLabel="Save my site"
        primarySupportingCopy="Your website is ready. Save it to your Luster account before choosing how you want to start."
        state={state}
      />,
    );

    expect(screen.getByText(/Save it to your Luster account/iu)).toBeVisible();
    expect(screen.queryByText(/Your website is saved/iu)).not.toBeInTheDocument();
  });

  it('keeps mobile readiness collapsed below the preview until the owner opens it', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
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
    if (!detail) {
      throw new Error('Missing readiness detail panel.');
    }

    expect(screen.getByRole('button', { name: /Ready to go.*View checklist/iu }))
      .toHaveAttribute('aria-expanded', 'false');

    await waitFor(() => expect(detail.inert).toBe(true));

    expect(detail).toHaveAttribute('aria-hidden', 'true');

    await userEvent.setup().click(screen.getByRole('button', { name: /View checklist/u }));
    await waitFor(() => expect(detail.inert).toBe(false));

    expect(detail).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('button', { name: /Hide checklist/u }))
      .toHaveAttribute('aria-expanded', 'true');

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
