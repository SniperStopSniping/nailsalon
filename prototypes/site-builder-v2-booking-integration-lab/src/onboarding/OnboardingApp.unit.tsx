import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';

import { initializeStarter, type SiteBuilderDocument } from '../model';
import type { LabDocumentController } from '../ui/useLabDocument';
import { createDanielaFixtureState } from './fixtures';
import type { OnboardingLabState } from './model/types';
import { ONBOARDING_STORAGE_KEY, serializeOnboardingState } from './storage/storage';
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

describe('OnboardingApp handoff boundaries', () => {
  beforeEach(() => {
    installMatchMedia();
    window.history.replaceState({}, '', '/');
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
