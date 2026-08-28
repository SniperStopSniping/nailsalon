import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';

import {
  SITE_BUILDER_STORAGE_KEY,
  exportSiteBuilderDocument,
  initializeStarter,
  parseSiteBuilderDocument,
  type SiteBuilderDocument,
} from '../model';
import { useLabDocument, type LabDocumentController } from '../ui/useLabDocument';
import { createDanielaFixtureState } from './fixtures';
import type { OnboardingLabState } from './model/types';
import {
  ONBOARDING_STORAGE_KEY,
  parseOnboardingState,
  serializeOnboardingState,
} from './storage/storage';
import {
  OnboardingApp,
  applyCanvaIntegrationResult,
  getOnboardingAssetIds,
} from './OnboardingApp';

vi.mock('../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetCoordinator: () => null,
  useCustomDesignAssetMap: () => new Map(),
  useCustomDesignAssetStorageError: () => null,
}));

const installMatchMedia = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })));
};

const stateAt = (
  screenId: OnboardingLabState['progress']['currentScreen'],
): OnboardingLabState => {
  const state = createDanielaFixtureState();
  state.progress.currentScreen = screenId;
  state.progress.lastActiveScreen = screenId;
  state.progress.lastSavedAt = null;
  state.progress.screenHistory = ['welcome', screenId];
  state.progress.sessionStatus = 'active';
  state.progress.visitedScreens = ['welcome', screenId];
  return state;
};

const createLab = (document: SiteBuilderDocument): LabDocumentController => ({
  canRedo: false,
  canUndo: false,
  chooseStarter: vi.fn(() => false),
  createHistoryCheckpoint: vi.fn(() => null),
  createStarterOnce: vi.fn(() => ({
    code: 'starter_already_created',
    message: 'A starting site has already been created.',
    success: false as const,
  })),
  document,
  exportJson: vi.fn(() => null),
  getHistorySnapshot: vi.fn(() => null),
  getReachableAssetIds: vi.fn(() => new Set<string>()),
  historyRevision: 0,
  importJson: vi.fn(() => ({ issues: [], success: false as const })),
  loadIssues: [],
  prepareCommand: vi.fn(() => ({
    code: 'not_available',
    message: 'Not available in this test.',
    success: false as const,
  })),
  redo: vi.fn(() => false),
  resetLab: vi.fn(() => true),
  resetToStarter: vi.fn(() => true),
  restoreHistoryCheckpoint: vi.fn(() => false),
  runCommand: vi.fn(() => ({
    code: 'not_available',
    message: 'Not available in this test.',
    success: false as const,
  })),
  saveStatus: 'saved',
  syncSiteName: vi.fn(() => true),
  transactionPending: false,
  undo: vi.fn(() => false),
});

const renderAt = (state: OnboardingLabState, onEnterBuilder = vi.fn()) => {
  window.localStorage.setItem(
    ONBOARDING_STORAGE_KEY,
    serializeOnboardingState(state),
  );
  const document = initializeStarter(state.recipe.starter ?? 'one_page', {
    siteId: state.recipe.starterDocumentSiteId ?? undefined,
    siteName: state.profile.businessName,
  });
  const lab = createLab(document);
  return {
    lab,
    onEnterBuilder,
    ...render(<OnboardingApp lab={lab} onEnterBuilder={onEnterBuilder} />),
  };
};

type BrowserHistoryEntry = {
  lusterOnboarding: true;
  onboardingCursor: number;
  onboardingSession: number;
  previewSource?: 'starting_preview' | 'site_style' | 'final_preview';
  screen: OnboardingLabState['progress']['currentScreen'];
};

const currentBrowserHistoryEntry = (): BrowserHistoryEntry =>
  window.history.state as BrowserHistoryEntry;

const dispatchBrowserHistoryEntry = (entry: BrowserHistoryEntry): void => {
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: entry })));
};

const setPageScroll = (top: number): void => {
  document.documentElement.scrollTop = top;
  document.body.scrollTop = top;
};

const expectFocusedHeadingAtTop = async (name: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { name });
  await waitFor(() => {
    expect(heading).toHaveFocus();
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
  });
  expect(heading).toHaveAttribute('tabindex', '-1');
  return heading;
};

function RealLabHarness({ onEnterBuilder = vi.fn() }: { onEnterBuilder?: () => void }) {
  const lab = useLabDocument();
  return <OnboardingApp lab={lab} onEnterBuilder={onEnterBuilder} />;
}

describe('OnboardingApp handoff boundaries', () => {
  beforeEach(() => {
    installMatchMedia();
    window.history.replaceState({}, '', '/');
    window.localStorage.removeItem(SITE_BUILDER_STORAGE_KEY);
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  });

  it('keeps the starting-site Preview inside setup and never exposes Builder or plans', async () => {
    const user = userEvent.setup();
    const state = stateAt('starting_preview');
    const { onEnterBuilder } = renderAt(state);

    expect(screen.getByRole('heading', { name: 'Your starting site is ready' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /open my builder/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Founding Nail Tech Lifetime Access')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Preview my site' }));
    const dialog = screen.getByRole('dialog', { name: 'Preview your starting site' });
    expect(within(dialog).getByRole('button', { name: 'Continue setup' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: /open my builder/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/lifetime access/i)).not.toBeInTheDocument();
    expect(onEnterBuilder).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Continue setup' }));
    expect(await screen.findByRole('heading', { name: 'Would you like an About section?' })).toBeVisible();
    expect(onEnterBuilder).not.toHaveBeenCalled();
  });

  it('skips About design when disabled while retaining the entered profile data', async () => {
    const user = userEvent.setup();
    const state = stateAt('about');
    const preservedBio = state.profile.about.shortBio;
    renderAt(state);

    const bio = screen.getByRole('textbox', { name: 'Short bio' });
    expect(bio).toHaveValue(preservedBio);
    await user.click(screen.getByRole('switch', { name: 'Include an About section' }));
    expect(bio).toBeDisabled();
    expect(bio).toHaveValue(preservedBio);

    await user.click(screen.getByRole('button', { name: 'Continue without About' }));
    expect(await screen.findByRole('heading', { name: 'Set clear expectations' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Choose your About design' })).not.toBeInTheDocument();

    await waitFor(() => {
      const saved = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
      expect(saved).toContain(preservedBio);
    });
  });

  it('restores About Off screens through repeated browser Back and Forward transitions', async () => {
    const user = userEvent.setup();
    const state = stateAt('about');
    state.recipe.aboutEnabled = false;
    renderAt(state);

    await expectFocusedHeadingAtTop('Would you like an About section?');
    setPageScroll(640);
    await user.click(screen.getByRole('button', { name: 'Continue without About' }));
    await expectFocusedHeadingAtTop('Set clear expectations');
    const { onboardingSession } = currentBrowserHistoryEntry();
    const aboutEntry: BrowserHistoryEntry = {
      lusterOnboarding: true,
      onboardingCursor: 0,
      onboardingSession,
      screen: 'about',
    };
    const policiesEntry: BrowserHistoryEntry = {
      lusterOnboarding: true,
      onboardingCursor: 1,
      onboardingSession,
      screen: 'policies',
    };

    for (let cycle = 0; cycle < 3; cycle += 1) {
      setPageScroll(420 + cycle);
      dispatchBrowserHistoryEntry(aboutEntry);
      await expectFocusedHeadingAtTop('Would you like an About section?');
      expect(screen.queryByRole('heading', {
        name: 'Choose your About design',
      })).not.toBeInTheDocument();

      setPageScroll(520 + cycle);
      dispatchBrowserHistoryEntry(policiesEntry);
      await expectFocusedHeadingAtTop('Set clear expectations');
    }
  });

  it('restores About On screens through repeated Back, Back, Forward, Forward transitions', async () => {
    const user = userEvent.setup();
    const state = stateAt('about');
    state.recipe.aboutEnabled = true;
    renderAt(state);

    await user.click(screen.getByRole('button', { name: 'Choose an About design' }));
    await expectFocusedHeadingAtTop('Choose your About design');
    await user.click(screen.getByRole('button', { name: 'Use this design' }));
    await expectFocusedHeadingAtTop('Set clear expectations');
    const { onboardingSession } = currentBrowserHistoryEntry();
    const entries = {
      about: {
        lusterOnboarding: true,
        onboardingCursor: 0,
        onboardingSession,
        screen: 'about',
      },
      aboutDesign: {
        lusterOnboarding: true,
        onboardingCursor: 1,
        onboardingSession,
        screen: 'about_design',
      },
      policies: {
        lusterOnboarding: true,
        onboardingCursor: 2,
        onboardingSession,
        screen: 'policies',
      },
    } satisfies Record<string, BrowserHistoryEntry>;

    for (let cycle = 0; cycle < 2; cycle += 1) {
      dispatchBrowserHistoryEntry(entries.aboutDesign);
      await expectFocusedHeadingAtTop('Choose your About design');
      dispatchBrowserHistoryEntry(entries.about);
      await expectFocusedHeadingAtTop('Would you like an About section?');
      dispatchBrowserHistoryEntry(entries.aboutDesign);
      await expectFocusedHeadingAtTop('Choose your About design');
      dispatchBrowserHistoryEntry(entries.policies);
      await expectFocusedHeadingAtTop('Set clear expectations');
    }
  });

  it('treats a full Preview as its own browser Back and Forward entry', async () => {
    const user = userEvent.setup();
    const state = stateAt('starting_preview');
    renderAt(state);
    const baseEntry = currentBrowserHistoryEntry();

    await user.click(screen.getByRole('button', { name: 'Preview my site' }));
    expect(screen.getByRole('dialog', { name: 'Preview your starting site' })).toBeVisible();
    const previewEntry: BrowserHistoryEntry = {
      ...baseEntry,
      onboardingCursor: baseEntry.onboardingCursor + 1,
      previewSource: 'starting_preview',
    };

    for (let cycle = 0; cycle < 3; cycle += 1) {
      dispatchBrowserHistoryEntry(baseEntry);
      await waitFor(() => expect(screen.queryByRole('dialog', {
        name: 'Preview your starting site',
      })).not.toBeInTheDocument());
      expect(screen.getByRole('heading', {
        name: 'Your starting site is ready',
      })).toBeVisible();

      dispatchBrowserHistoryEntry(previewEntry);
      expect(await screen.findByRole('dialog', {
        name: 'Preview your starting site',
      })).toBeVisible();
      expect(screen.queryByRole('button', { name: /Open my Builder/iu }))
        .not.toBeInTheDocument();
    }
  });

  it('invalidates pre-reset browser entries so they cannot restore the old session', async () => {
    const user = userEvent.setup();
    const state = stateAt('policies');
    const { lab } = renderAt(state);
    const staleEntry = currentBrowserHistoryEntry();
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);

    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    await user.click(screen.getByRole('button', { name: 'Restart onboarding' }));
    const confirmation = screen.getByRole('dialog', { name: 'Restart onboarding?' });
    await user.click(within(confirmation).getByRole('button', {
      name: 'Restart onboarding',
    }));

    expect(await screen.findByRole('heading', { name: 'Let’s build your website' })).toBeVisible();
    expect(lab.resetLab).toHaveBeenCalledOnce();
    const resetEntry = currentBrowserHistoryEntry();
    expect(resetEntry.screen).toBe('welcome');
    expect(resetEntry.onboardingCursor).toBe(0);
    expect(resetEntry.onboardingSession).not.toBe(staleEntry.onboardingSession);

    dispatchBrowserHistoryEntry({
      ...staleEntry,
      onboardingCursor: staleEntry.onboardingCursor + 1,
      screen: 'policies',
    });
    expect(forward).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Let’s build your website' })).toBeVisible();
    expect(currentBrowserHistoryEntry()).toEqual(resetEntry);
    forward.mockRestore();
  });

  it('shows the plan offer only after the explicit final handoff and enters Builder after Continue free', async () => {
    const user = userEvent.setup();
    const state = stateAt('final_preview');
    const onEnterBuilder = vi.fn();
    const { lab } = renderAt(state, onEnterBuilder);

    expect(screen.getByRole('button', { name: 'Open my Builder' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Your site is saved' })).not.toBeInTheDocument();
    expect(onEnterBuilder).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Open my Builder' }));
    expect(lab.syncSiteName).toHaveBeenCalledWith('Isla Nail Studio');
    const offer = screen.getByRole('dialog', { name: 'Your site is saved' });
    expect(within(offer).getByRole('button', { name: 'Continue free' })).toBeVisible();
    expect(onEnterBuilder).not.toHaveBeenCalled();

    await user.click(within(offer).getByRole('button', { name: 'Continue free' }));
    expect(onEnterBuilder).toHaveBeenCalledOnce();
    const saved = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    expect(saved).toContain('"planIntent":"free"');
    expect(saved).toContain('"sessionStatus":"builder"');
  });

  it('confirms a starter change, preserves profile data, and resumes the switched starter after reload', async () => {
    const user = userEvent.setup();
    const state = stateAt('starter');
    state.recipe.starter = 'quick_book';
    state.recipe.starterDocumentSiteId = 'site-onboarding-switch';
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      serializeOnboardingState(state),
    );
    window.localStorage.setItem(
      SITE_BUILDER_STORAGE_KEY,
      exportSiteBuilderDocument(initializeStarter('quick_book', {
        siteId: state.recipe.starterDocumentSiteId,
        siteName: state.profile.businessName,
      })),
    );

    const firstRender = render(<RealLabHarness />);
    const current = screen.getByRole('button', {
      name: /Current starting point.*Quick Book/u,
    });
    expect(current).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', {
      name: /Switch to One-page website/u,
    }));
    const confirmation = screen.getByRole('dialog', {
      name: 'Switch to this starting point?',
    });
    expect(confirmation).toHaveTextContent(
      'Your business information, About details, policies, style choices, photos, Gallery draft, Canva design, and onboarding progress will stay saved. We’ll replace only the starting page structure.',
    );
    expect(within(confirmation).getByRole('button', { name: 'Keep current' }))
      .toBeVisible();
    await user.click(within(confirmation).getByRole('button', {
      name: 'Switch starting point',
    }));

    expect(await screen.findByRole('heading', {
      name: 'Your starting site is ready',
    })).toBeVisible();
    expect(screen.getByRole('region', {
      name: 'Isla Nail Studio starting website preview',
    })).toBeVisible();

    await waitFor(() => {
      const savedOnboarding = parseOnboardingState(
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '',
      );
      expect(savedOnboarding.status).toBe('loaded');
      expect(savedOnboarding.state.profile.about.shortBio)
        .toBe(state.profile.about.shortBio);
      expect(savedOnboarding.state.recipe.starter).toBe('one_page');
      expect(savedOnboarding.state.progress.currentScreen)
        .toBe('starting_preview');

      const savedDocument = parseSiteBuilderDocument(
        window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY) ?? '',
      );
      expect(savedDocument.success).toBe(true);
      if (savedDocument.success) {
        expect(savedDocument.document.originStarter).toBe('one_page');
        expect(savedDocument.document.pages[0]?.sections).toHaveLength(6);
      }
    });

    firstRender.unmount();
    render(<RealLabHarness />);
    expect(await screen.findByRole('heading', {
      name: 'Your starting site is ready',
    })).toBeVisible();
    expect(screen.getByText('One-page website')).toBeVisible();
    expect(screen.getByRole('region', {
      name: 'Isla Nail Studio starting website preview',
    })).toBeVisible();
  });
});

describe('OnboardingApp Canva draft boundaries', () => {
  it('stores only accepted pages and marks a partial upload for readiness review', () => {
    const state = createDanielaFixtureState();
    state.canva.images = [];
    state.canva.status = 'empty';
    state.recipe.canvaEnabled = false;

    const next = applyCanvaIntegrationResult(state, {
      addedCount: 1,
      addedImages: [{
        assetId: 'asset-accepted',
        fileName: 'accepted.png',
        id: 'image-accepted',
        mimeType: 'image/png',
      }],
      failures: [{ fileName: 'rejected.pdf', message: 'PDF is not supported.' }],
      sectionId: 'section-canva',
      status: 'partial',
    }, 'contained', 'after_booking');

    expect(next.canva).toMatchObject({
      errorMessage: 'PDF is not supported.',
      status: 'invalid',
    });
    expect(next.canva.images).toEqual([expect.objectContaining({
      fileName: 'accepted.png',
      storageId: 'asset-accepted',
    })]);
    expect(next.recipe.canvaEnabled).toBe(true);
    expect(getOnboardingAssetIds(next)).toEqual(['asset-accepted']);
  });
});
