import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  exportSiteBuilderDocument,
  initializeStarter,
  isLibrarySection,
  SITE_BUILDER_STORAGE_KEY,
  type SiteBuilderDocument,
  updateLibrarySectionSettings,
} from '../model';
import { createDefaultOnboardingState } from '../onboarding/model/defaults';
import {
  ONBOARDING_STORAGE_KEY,
  saveOnboardingState,
} from '../onboarding/storage/storage';
import { App } from './App';

const originalScrollIntoView = Element.prototype.scrollIntoView;

const installBrowserHarness = (): void => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    matches: query.includes('min-width: 900px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal('scrollTo', vi.fn());
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(document.body, 'clientWidth', {
    configurable: true,
    value: 1440,
  });
};

const seedBuilder = (
  document: SiteBuilderDocument,
  businessStructure: 'solo' | 'multi_tech' = 'multi_tech',
): void => {
  window.localStorage.setItem(
    SITE_BUILDER_STORAGE_KEY,
    exportSiteBuilderDocument(document),
  );
  const onboarding = createDefaultOnboardingState();
  onboarding.profile.businessStructure = businessStructure;
  const saved = saveOnboardingState(onboarding, {
    timestamp: '2026-08-31T12:00:00.000Z',
  });
  if (!saved.success) {
    throw new Error(saved.message);
  }
};

const readDocument = (): SiteBuilderDocument => {
  const raw = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY);
  if (!raw) {
    throw new Error('Builder document was not saved.');
  }
  return JSON.parse(raw) as SiteBuilderDocument;
};

const openLibraryAtBottom = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', {
    name: 'Add section at bottom of Home',
  }));
  return screen.findByRole('dialog', { name: 'Add section' });
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '?surface=builder');
  installBrowserHarness();
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(SITE_BUILDER_STORAGE_KEY);
  window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: originalScrollIntoView,
  });
});

describe('Builder overlap resolution UI', () => {
  it.each([
    {
      addLabel: 'Add Hours',
      addType: 'hours' as const,
      anywayLabel: 'Add the separate Hours section anyway',
      keepLabel: 'Keep hours inside Visit Us',
      resolutionLabel: 'Remove hours from Visit Us and add the section',
      setting: 'hoursSummary' as const,
      title: 'Hours are already shown',
    },
    {
      addLabel: 'Add Contact',
      addType: 'contact' as const,
      anywayLabel: 'Add the separate Contact section anyway',
      keepLabel: 'Keep contact inside Visit Us',
      resolutionLabel: 'Remove contact from Visit Us and add the section',
      setting: 'contactSummary' as const,
      title: 'Contact details are already shown',
    },
  ])('moves $addType out of Visit Us as one undoable change', async ({
    addLabel,
    addType,
    anywayLabel,
    keepLabel,
    resolutionLabel,
    setting,
    title,
  }) => {
    const original = initializeStarter('one_page');
    seedBuilder(original);
    const user = userEvent.setup();
    render(<App />);

    const library = await openLibraryAtBottom(user);
    await user.click(within(library).getByRole('button', { name: addLabel }));
    const warning = await screen.findByRole('dialog', { name: title });

    expect(within(warning).getByRole('button', {
      name: keepLabel,
    })).toBeVisible();
    expect(within(warning).getByRole('button', {
      name: anywayLabel,
    })).toBeVisible();

    await user.click(within(warning).getByRole('button', {
      name: resolutionLabel,
    }));

    await waitFor(() => {
      const saved = readDocument();

      expect(saved.pages[0]?.sections.some(section => section.sectionType === addType))
        .toBe(true);

      const visitUs = saved.pages[0]?.sections.find(
        section => section.sectionType === 'visit_us',
      );

      expect(isLibrarySection(visitUs!)
        && visitUs.sectionType === 'visit_us'
        && visitUs.settings[setting]).toBe('hide');
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(readDocument()).toEqual(original));
  });

  it('opens a named hard-limit dialog and navigates to the exact existing Hero', async () => {
    const document = initializeStarter('one_page');
    seedBuilder(document);
    const user = userEvent.setup();
    render(<App />);

    const library = await openLibraryAtBottom(user);
    await user.click(within(library).getByRole('button', {
      name: 'Go to Hero',
    }));
    const warning = await screen.findByRole('dialog', {
      name: 'Hero is already on Home',
    });

    expect(within(warning).getByText(/only once per page/)).toBeVisible();

    await user.click(within(warning).getByRole('button', {
      name: 'Go to Hero',
    }));

    const hero = screen.getByRole('listitem', { name: 'Welcome on Home' });

    expect(hero.querySelector('.section-card__select-surface'))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('walks the duplicate About warning before opening the real move flow', async () => {
    // About is not part of the locked Quick Book document. The duplicate
    // warning remains an advanced Builder behavior and is exercised on the
    // one-page recipe, where About is an approved core section.
    seedBuilder(initializeStarter('one_page'));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', {
      name: 'Add section after About',
    }));
    const library = await screen.findByRole('dialog', { name: 'Add section' });
    await user.click(within(library).getByRole('button', {
      name: 'Add About',
    }));

    const duplicate = await screen.findByRole('dialog', {
      name: 'About is already on your site',
    });

    expect(within(duplicate).getByRole('button', {
      name: 'Go to existing About',
    })).toBeVisible();

    await user.click(within(duplicate).getByRole('button', { name: 'Add it anyway' }));

    await waitFor(() => expect(readDocument().pages[0]?.sections.filter(
      section => section.sectionType === 'about',
    )).toHaveLength(2));

    const actions = await screen.findByRole('group', { name: 'About actions' });
    await user.click(within(actions).getByRole('button', { name: 'Move' }));
    expect(await screen.findByRole('dialog', { name: 'Move About' })).toBeVisible();
  });

  it('switches the duplicate About policy design through the advisory and Undo restores it', async () => {
    const original = initializeStarter('one_page');
    const about = original.pages[0]?.sections.find(
      section => section.sectionType === 'about',
    );
    if (!about) {
      throw new Error('One-page starter did not contain About.');
    }
    const customized = updateLibrarySectionSettings(original, about.id, {
      ...('settings' in about ? about.settings : {}),
      preset: 'about_before_you_book',
      version: 1,
    });
    seedBuilder(customized);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', {
      name: 'Open Pages & Structure for Home',
    }));
    const structure = await screen.findByRole('dialog', { name: 'Pages & Structure' });
    await user.click(within(structure).getByRole('button', {
      name: 'Switch About to a design without policies',
    }));

    await waitFor(() => {
      const savedAbout = readDocument().pages[0]?.sections.find(
        section => section.id === about.id,
      );

      expect(isLibrarySection(savedAbout!)
        && savedAbout.sectionType === 'about'
        && savedAbout.settings.preset).toBe('photo_right');
    });
    const toolbarUndo = document.querySelector<HTMLButtonElement>(
      '.final-topbar__history button[aria-label="Undo"]',
    );
    if (!toolbarUndo) {
      throw new Error('Builder toolbar Undo was not rendered.');
    }
    await user.click(toolbarUndo);
    await waitFor(() => expect(readDocument()).toEqual(customized));
  });

  it('deep-links a solo owner to the existing business setup screen', async () => {
    seedBuilder(initializeStarter('one_page'), 'solo');
    const user = userEvent.setup();
    render(<App />);

    const library = await openLibraryAtBottom(user);
    await user.click(within(library).getByRole('button', { name: 'Add Team' }));
    const warning = await screen.findByRole('dialog', { name: 'Solo business' });
    await user.click(within(warning).getByRole('button', {
      name: 'Change business setup',
    }));

    expect(await screen.findByRole('heading', { name: 'Let’s start with your business' })).toBeVisible();
    expect(screen.getByRole('group', {
      name: 'Which best describes your business?',
    })).toBeVisible();
  });
});
