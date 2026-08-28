import { act, renderHook } from '@testing-library/react';

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
});
