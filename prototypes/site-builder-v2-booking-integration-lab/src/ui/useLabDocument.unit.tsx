import { act, renderHook, waitFor } from '@testing-library/react';

import { SITE_BUILDER_STORAGE_KEY } from '../model';
import { useLabDocument } from './useLabDocument';

describe('useLabDocument onboarding profile synchronization', () => {
  beforeEach(() => {
    window.localStorage.removeItem(SITE_BUILDER_STORAGE_KEY);
  });

  it('keeps the created Builder document name connected to later Business Profile edits', () => {
    const hook = renderHook(() => useLabDocument());

    act(() => {
      expect(hook.result.current.createStarterOnce('quick_book', {
        siteName: 'First Studio Name',
      }).success).toBe(true);
    });
    expect(hook.result.current.document?.siteName).toBe('First Studio Name');

    act(() => {
      expect(hook.result.current.syncSiteName('Renamed Studio')).toBe(true);
    });

    expect(hook.result.current.document?.siteName).toBe('Renamed Studio');
    expect(hook.result.current.document?.originStarter).toBe('quick_book');
    // Renaming touches only siteName: the exact three-section Quick Book recipe
    // remains intact, without old hidden composition sections.
    expect(hook.result.current.document?.pages[0]?.sections.map(
      (section) => section.sectionType,
    )).toEqual([
      'hero',
      'booking',
      'gallery',
    ]);
  });

  it('keeps the current document when its saved browser record cannot be cleared', async () => {
    const hook = renderHook(() => useLabDocument());
    act(() => {
      expect(hook.result.current.createStarterOnce('quick_book', {
        siteName: 'Stored Studio',
      }).success).toBe(true);
    });
    await waitFor(() => expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY))
      .not.toBeNull());
    const savedDocument = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY);
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(
      function rejectBuilderReset(this: Storage, key: string) {
        if (key === SITE_BUILDER_STORAGE_KEY) {
          throw new DOMException('Blocked', 'SecurityError');
        }
      },
    );

    let reset = true;
    act(() => {
      reset = hook.result.current.resetLab();
    });

    expect(reset).toBe(false);
    expect(hook.result.current.document?.siteName).toBe('Stored Studio');
    expect(hook.result.current.saveStatus).toBe('error');
    expect(hook.result.current.loadIssues).toContain(
      'The saved site could not be cleared from this browser.',
    );
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).toBe(savedDocument);
    removeItem.mockRestore();
  });

  it('atomically accepts onboarding presentation choices without changing stable IDs', () => {
    const hook = renderHook(() => useLabDocument());
    act(() => {
      expect(hook.result.current.createStarterOnce('one_page', {
        siteName: 'First Studio Name',
      }).success).toBe(true);
    });
    const originalIds = hook.result.current.document?.pages
      .flatMap(page => page.sections.map(section => section.id));

    act(() => {
      expect(hook.result.current.acceptOnboardingPresentation('Accepted Studio', {
        aboutPreset: 'about_before_you_book',
        galleryLayout: 'editorial',
      })).not.toBeNull();
    });

    const accepted = hook.result.current.document;
    expect(accepted).not.toBeNull();
    if (!accepted) throw new Error('Expected the accepted Builder document.');
    expect(accepted.siteName).toBe('Accepted Studio');
    expect(accepted.pages.flatMap(page => page.sections)
      .find(section => section.sectionType === 'about'))
      .toMatchObject({ settings: { preset: 'about_before_you_book' } });
    expect(accepted.pages.flatMap(page => page.sections)
      .find(section => section.sectionType === 'gallery'))
      .toMatchObject({ settings: { preset: 'editorial' } });
    expect(accepted.pages.flatMap(page => page.sections.map(section => section.id)))
      .toEqual(originalIds);
    expect(hook.result.current.document).toEqual(accepted);
  });
});
