import { act, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';

import {
  IndexedDbAssetRepository,
  type PreparedImageAsset,
} from '../custom-design/assets';
import { CustomDesignAssetTransactionCoordinator } from '../custom-design/integration/AssetTransactionCoordinator';
import {
  SITE_BUILDER_STORAGE_KEY,
  exportSiteBuilderDocument,
  initializeStarter,
  parseSiteBuilderDocument,
  type SiteBuilderDocument,
} from '../model';
import { useLabDocument, type LabDocumentController } from '../ui/useLabDocument';
import { createDanielaFixtureState } from './fixtures';
import { FeedbackProvider } from './feedback/FeedbackProvider';
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
  isOnboardingResetBlocked,
} from './OnboardingApp';

const assetProviderMocks = vi.hoisted(() => ({
  coordinator: null as unknown,
  repository: null as unknown,
}));

vi.mock('../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetCoordinator: () => assetProviderMocks.coordinator,
  useCustomDesignAssetMap: () => new Map(),
  useCustomDesignAssetRepository: () => assetProviderMocks.repository,
  useCustomDesignAssetStorageError: () => null,
}));

const storedAsset = (id: string): PreparedImageAsset => {
  const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
    type: 'image/png',
  });
  return {
    blob,
    metadata: {
      aspectRatio: 0.75,
      byteSize: blob.size,
      createdAt: '2026-08-28T12:00:00.000Z',
      fileName: `${id}.png`,
      height: 1_600,
      id,
      mimeType: 'image/png',
      orientation: 1,
      width: 1_200,
    },
  };
};

const createAssetCleanupHarness = async (name: string) => {
  const repository = new IndexedDbAssetRepository({
    dbName: name,
    indexedDB: new IDBFactory(),
  });
  const coordinator = new CustomDesignAssetTransactionCoordinator({
    getReachableAssetIds: () => new Set<string>(),
    repository,
  });
  for (const assetId of ['onboarding-removed', 'unrelated-sentinel']) {
    await repository.stage(storedAsset(assetId));
    await repository.commit(assetId);
  }
  return { coordinator, repository };
};

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

const renderAt = (
  state: OnboardingLabState,
  onEnterBuilder = vi.fn(),
  auditMode = true,
) => {
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
    ...render(<OnboardingApp auditMode={auditMode} lab={lab} onEnterBuilder={onEnterBuilder} />),
  };
};

const renderAtWithFeedback = (
  state: OnboardingLabState,
  onEnterBuilder = vi.fn(),
) => {
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
    ...render(
      <FeedbackProvider testMode>
        <OnboardingApp auditMode lab={lab} onEnterBuilder={onEnterBuilder} />
      </FeedbackProvider>,
    ),
  };
};

type BrowserHistoryEntry = {
  lusterOnboarding: true;
  onboardingCursor: number;
  onboardingSession: number;
  overlay?:
    | { kind: 'plan' }
    | {
        kind: 'preview';
        source: 'starting_preview' | 'about' | 'about_design' | 'site_style' | 'final_preview';
      };
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
    assetProviderMocks.coordinator = null;
    assetProviderMocks.repository = null;
    installMatchMedia();
    window.history.replaceState({}, '', '/');
    window.localStorage.removeItem(SITE_BUILDER_STORAGE_KEY);
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  });

  it('blocks Start over while either document or profile media work is pending', () => {
    expect(isOnboardingResetBlocked(false, 0)).toBe(false);
    expect(isOnboardingResetBlocked(true, 0)).toBe(true);
    expect(isOnboardingResetBlocked(false, 1)).toBe(true);
    expect(isOnboardingResetBlocked(true, 2)).toBe(true);
  });

  it('hides Lab review options during the normal owner journey', async () => {
    const user = userEvent.setup();
    renderAt(stateAt('policies'), vi.fn(), false);
    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    expect(screen.queryByRole('menuitem', { name: 'Lab review options' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Start over' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Save and finish later' })).toBeVisible();
  });

  it('keeps the starting-site Preview inside setup and never exposes Builder or plans', async () => {
    const user = userEvent.setup();
    const state = stateAt('starting_preview');
    const { onEnterBuilder } = renderAt(state);

    expect(screen.getByRole('heading', { name: 'Your starting site is ready' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /finish setup/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Founding Nail Tech Lifetime Access')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Preview my site' }));
    const dialog = screen.getByRole('dialog', { name: 'Preview your starting site' });
    expect(within(dialog).getByRole('button', { name: 'Continue setup' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: /finish setup/i })).not.toBeInTheDocument();
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

  it('passes over a stale About-design browser entry after About is turned off', async () => {
    const state = stateAt('about');
    state.recipe.aboutEnabled = false;
    renderAt(state);
    const { onboardingSession } = currentBrowserHistoryEntry();
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);

    dispatchBrowserHistoryEntry({
      lusterOnboarding: true,
      onboardingCursor: 1,
      onboardingSession,
      screen: 'about_design',
    });

    expect(forward).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Would you like an About section?' }))
      .toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Choose your About design' }))
      .not.toBeInTheDocument();
    forward.mockRestore();
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
      overlay: { kind: 'preview', source: 'starting_preview' },
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
      expect(screen.queryByRole('button', { name: /Finish setup/iu }))
        .not.toBeInTheDocument();
    }
  });

  it('uses the Screen 7 close button only to dismiss Preview and restore its trigger', async () => {
    const user = userEvent.setup();
    const state = stateAt('starting_preview');
    renderAt(state);
    const baseEntry = currentBrowserHistoryEntry();
    const previewTrigger = screen.getByRole('button', { name: 'Preview my site' });

    await user.click(previewTrigger);
    const dialog = screen.getByRole('dialog', { name: 'Preview your starting site' });
    await user.click(within(dialog).getByRole('button', {
      name: 'Close Preview your starting site',
    }));
    dispatchBrowserHistoryEntry(baseEntry);

    await waitFor(() => expect(screen.queryByRole('dialog', {
      name: 'Preview your starting site',
    })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Your starting site is ready' }))
      .toBeVisible();
    expect(screen.queryByRole('heading', {
      name: 'Would you like an About section?',
    })).not.toBeInTheDocument();
    await waitFor(() => expect(previewTrigger).toHaveFocus());
  });

  it('invalidates pre-reset browser entries so they cannot restore the old session', async () => {
    const user = userEvent.setup();
    const state = stateAt('policies');
    const { lab } = renderAt(state);
    const staleEntry = currentBrowserHistoryEntry();
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);

    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start over' }));
    const confirmation = screen.getByRole('dialog', { name: 'Start over?' });
    await user.click(within(confirmation).getByRole('button', {
      name: 'Start over',
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

  it('uses the exact scoped Start over warning and guards repeat activation while cleanup is pending', async () => {
    const user = userEvent.setup();
    const state = stateAt('policies');
    let finishCleanup: ((errors: Error[]) => void) | undefined;
    const deleteAssetsIfUnreferenced = vi.fn(() => new Promise<Error[]>((resolve) => {
      finishCleanup = resolve;
    }));
    assetProviderMocks.coordinator = { deleteAssetsIfUnreferenced };
    const { lab } = renderAt(state);

    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start over' }));
    const dialog = screen.getByRole('dialog', { name: 'Start over?' });
    expect(dialog).toHaveAccessibleDescription(
      'This clears your onboarding answers, uploaded setup images and starting website from this device. Other saved Builder work stays untouched.',
    );
    expect(within(dialog).getByRole('button', { name: 'Keep my setup' })).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: 'Start over' }));
    const pending = within(dialog).getByRole('button', { name: 'Starting over…' });
    expect(pending).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close Start over?' }))
      .toBeDisabled();
    expect(lab.resetLab).toHaveBeenCalledOnce();
    expect(deleteAssetsIfUnreferenced).toHaveBeenCalledOnce();

    finishCleanup?.([]);
    const welcomeHeading = await screen.findByRole('heading', { name: 'Let’s build your website' });
    await waitFor(() => expect(welcomeHeading).toHaveFocus());
    expect(lab.resetLab).toHaveBeenCalledOnce();
  });

  it('deletes a removed, reloaded onboarding-owned asset on Reset while preserving an unrelated asset', async () => {
    const user = userEvent.setup();
    const state = stateAt('policies');
    state.canva.images = [];
    state.canva.ownedAssetIds = ['onboarding-removed'];
    const { coordinator, repository } = await createAssetCleanupHarness(
      'onboarding-reset-owned-assets',
    );
    assetProviderMocks.coordinator = coordinator;
    window.localStorage.setItem('unrelated-storage-sentinel', 'preserve');

    renderAt(state);
    expect(parseOnboardingState(
      window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '',
    ).state.canva.ownedAssetIds).toEqual(['onboarding-removed']);

    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start over' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Start over?' }))
      .getByRole('button', { name: 'Start over' }));

    expect(await screen.findByRole('heading', { name: 'Let’s build your website' })).toBeVisible();
    await waitFor(async () => {
      expect(await repository.has('onboarding-removed')).toBe(false);
      expect(await repository.has('unrelated-sentinel')).toBe(true);
    });
    expect(window.localStorage.getItem('unrelated-storage-sentinel')).toBe('preserve');
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    window.localStorage.removeItem('unrelated-storage-sentinel');
    coordinator.close();
    repository.close();
  });

  it('uses the same scoped owned-asset cleanup before replacing state with a fixture', async () => {
    const user = userEvent.setup();
    const state = stateAt('policies');
    state.canva.images = [];
    state.canva.ownedAssetIds = ['onboarding-removed'];
    const { coordinator, repository } = await createAssetCleanupHarness(
      'onboarding-fixture-owned-assets',
    );
    assetProviderMocks.coordinator = coordinator;

    renderAt(state);
    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Lab review options' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Lab review options' }))
      .getByRole('button', { name: 'Blank new owner' }));

    expect(await screen.findByRole('heading', { name: 'Let’s build your website' })).toBeVisible();
    await waitFor(async () => {
      expect(await repository.has('onboarding-removed')).toBe(false);
      expect(await repository.has('unrelated-sentinel')).toBe(true);
    });
    await waitFor(() => {
      const saved = parseOnboardingState(
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '',
      );
      expect(saved.state.canva.ownedAssetIds).toEqual([]);
    });
    coordinator.close();
    repository.close();
  });

  it('keeps the ownership ledger and current answers when Reset asset cleanup fails', async () => {
    const user = userEvent.setup();
    const state = stateAt('policies');
    state.canva.images = [];
    state.canva.ownedAssetIds = ['onboarding-orphan-retry'];
    const deleteAssetsIfUnreferenced = vi.fn(async () => [
      new Error('The browser could not remove one saved image.'),
    ]);
    assetProviderMocks.coordinator = { deleteAssetsIfUnreferenced };

    const { lab } = renderAt(state);
    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start over' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Start over?' }))
      .getByRole('button', { name: 'Start over' }));

    expect(await screen.findByRole('heading', { name: 'Let’s build your website' })).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('cleanup list');
    expect(lab.resetLab).toHaveBeenCalledOnce();
    expect(deleteAssetsIfUnreferenced).toHaveBeenCalledWith([
      'onboarding-orphan-retry',
    ]);
    await waitFor(() => expect(parseOnboardingState(
      window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '',
    ).state.canva.ownedAssetIds).toEqual(['onboarding-orphan-retry']));
  });

  it('does not destroy the site document when onboarding storage cannot be reset', async () => {
    const user = userEvent.setup();
    const state = stateAt('policies');
    const { lab } = renderAt(state);
    const originalRemoveItem = Storage.prototype.removeItem;
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(
      function removeStorageItem(this: Storage, key: string) {
        if (key === ONBOARDING_STORAGE_KEY) throw new DOMException('Blocked', 'SecurityError');
        originalRemoveItem.call(this, key);
      },
    );

    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start over' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Start over?' }))
      .getByRole('button', { name: 'Start over' }));

    expect(await screen.findByText('Onboarding browser storage could not be cleared.'))
      .toBeVisible();
    expect(screen.getByRole('heading', { name: 'Set clear expectations' })).toBeVisible();
    expect(lab.resetLab).not.toHaveBeenCalled();
    expect(parseOnboardingState(
      window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '',
    ).state.profile.businessName).toBe(state.profile.businessName);
    removeItem.mockRestore();
  });

  it('restores onboarding when the saved Builder document cannot be reset', async () => {
    const user = userEvent.setup();
    const state = stateAt('policies');
    const { lab } = renderAt(state);
    vi.mocked(lab.resetLab).mockReturnValueOnce(false);

    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start over' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Start over?' }))
      .getByRole('button', { name: 'Start over' }));

    expect(await screen.findByText('Setup could not be restarted safely. Your setup was restored.'))
      .toBeVisible();
    expect(screen.getByRole('heading', { name: 'Set clear expectations' })).toBeVisible();
    expect(lab.resetLab).toHaveBeenCalledOnce();
    await waitFor(() => expect(parseOnboardingState(
      window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '',
    ).state.profile.businessName).toBe(state.profile.businessName));
  });

  it('keeps the ownership ledger instead of replacing it when fixture cleanup fails', async () => {
    const user = userEvent.setup();
    const state = stateAt('policies');
    state.canva.images = [];
    state.canva.ownedAssetIds = ['fixture-orphan-retry'];
    const deleteAssetsIfUnreferenced = vi.fn(async () => [
      new Error('The browser could not remove one saved image.'),
    ]);
    assetProviderMocks.coordinator = { deleteAssetsIfUnreferenced };

    renderAt(state);
    await user.click(screen.getByRole('button', { name: 'More onboarding options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Lab review options' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Lab review options' }))
      .getByRole('button', { name: 'Blank new owner' }));

    expect(await screen.findByRole('heading', { name: 'Let’s build your website' })).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('cleanup list');
    await waitFor(() => expect(parseOnboardingState(
      window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '',
    ).state.canva.ownedAssetIds).toEqual(['fixture-orphan-retry']));
  });

  it('shows the plan offer only after Finish setup and enters the dashboard after Continue free', async () => {
    const user = userEvent.setup();
    const state = stateAt('final_preview');
    const onEnterBuilder = vi.fn();
    const { lab } = renderAt(state, onEnterBuilder);

    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Your site is saved' })).not.toBeInTheDocument();
    expect(onEnterBuilder).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(lab.syncSiteName).toHaveBeenCalledWith('Isla Nail Studio');
    const offer = screen.getByRole('dialog', { name: 'Your site is saved' });
    expect(within(offer).getByRole('button', { name: 'Continue free' })).toBeVisible();
    expect(onEnterBuilder).not.toHaveBeenCalled();

    await user.click(within(offer).getByRole('button', { name: 'Continue free' }));
    expect(onEnterBuilder).toHaveBeenCalledOnce();
    const saved = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    expect(saved).toContain('"planIntent":"free"');
    expect(saved).toContain('"sessionStatus":"dashboard"');
  });

  it('treats the plan offer as a Review overlay for browser Back and Forward', async () => {
    const user = userEvent.setup();
    const state = stateAt('final_preview');
    renderAt(state);
    const baseEntry = currentBrowserHistoryEntry();
    const builderTrigger = screen.getByRole('button', { name: 'Finish setup' });

    await user.click(builderTrigger);
    const planEntry = currentBrowserHistoryEntry();
    expect(planEntry).toMatchObject({ overlay: { kind: 'plan' }, screen: 'final_preview' });
    expect(screen.getByRole('dialog', { name: 'Your site is saved' })).toBeVisible();

    dispatchBrowserHistoryEntry(baseEntry);
    await waitFor(() => expect(screen.queryByRole('dialog', {
      name: 'Your site is saved',
    })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Review your site' })).toBeVisible();
    await waitFor(() => expect(builderTrigger).toHaveFocus());

    dispatchBrowserHistoryEntry(planEntry);
    const reopened = await screen.findByRole('dialog', { name: 'Your site is saved' });
    await waitFor(() => expect(within(reopened).getByRole('heading', {
      name: 'Your site is saved',
    })).toHaveFocus());
    expect(screen.getByRole('heading', { name: 'Review your site' })).toBeVisible();
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
      name: 'Switch to One-page website?',
    });
    expect(confirmation).toHaveTextContent(
      'Switching to One-page website keeps your business information, About details, policies, style choices, photos, Gallery draft, Canva design, and onboarding progress saved. We’ll replace only the starting page structure.',
    );
    expect(within(confirmation).getByRole('button', { name: 'Keep current' }))
      .toBeVisible();
    await user.click(within(confirmation).getByRole('button', {
      name: 'Switch to One-page website',
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
    expect(screen.getAllByText('One-page website').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', {
      name: 'Isla Nail Studio starting website preview',
    })).toBeVisible();
  });

  it('keeps the starting-site reveal visible while remembering the newly complete Booking stage', async () => {
    const user = userEvent.setup();
    const state = stateAt('starter');
    state.recipe.starter = null;
    state.recipe.starterDocumentSiteId = null;
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, serializeOnboardingState(state));
    window.localStorage.removeItem(SITE_BUILDER_STORAGE_KEY);

    render(
      <FeedbackProvider testMode>
        <RealLabHarness />
      </FeedbackProvider>,
    );
    await user.click(screen.getByRole('button', { name: /Start with One-page/u }));

    expect(document.querySelector('.onboarding-feedback')).toHaveTextContent(
      'Your starting site is ready',
    );
    await waitFor(() => {
      const saved = parseOnboardingState(
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '',
      );
      expect(saved.state.reviewOptions.feedbackMilestones).toEqual(
        expect.arrayContaining(['starting_site_ready', 'stage_booking']),
      );
    });
  });

  it('shows website-style completion before the queued all-required milestone', async () => {
    const user = userEvent.setup();
    const state = stateAt('site_style');
    state.recipe.styleConfirmed = false;
    renderAtWithFeedback(state);

    await user.click(screen.getByRole('button', { name: /^Use /u }));

    expect(document.querySelector('.onboarding-feedback')).toHaveTextContent(
      'Your website style is set',
    );
    await waitFor(() => {
      const saved = parseOnboardingState(
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '',
      );
      expect(saved.state.reviewOptions.feedbackMilestones).toEqual(
        expect.arrayContaining(['stage_design', 'all_required_complete']),
      );
    });
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
      errorMessage: '1 image was added. 1 file could not be processed.',
      status: 'ready',
      uploadResult: {
        addedCount: 1,
        failures: [{ fileName: 'rejected.pdf', message: 'PDF is not supported.' }],
      },
    });
    expect(next.canva.images).toEqual([expect.objectContaining({
      fileName: 'accepted.png',
      storageId: 'asset-accepted',
    })]);
    expect(next.recipe.canvaEnabled).toBe(true);
    expect(getOnboardingAssetIds(next)).toEqual(['asset-accepted']);
  });

  it('collects removed ledger assets and current pages once for scoped cleanup', () => {
    const state = createDanielaFixtureState();
    state.canva.ownedAssetIds = ['asset-removed', 'asset-current'];
    state.canva.images = [{
      fileName: 'current.png',
      id: 'image-current',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'asset-current',
    }];

    expect(getOnboardingAssetIds(state)).toEqual([
      'asset-removed',
      'asset-current',
    ]);
  });
});
