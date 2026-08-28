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
    expect(hook.result.current.document?.pages[0]?.sections).toHaveLength(3);
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
});
