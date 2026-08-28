import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingStorage } from '../storage/storage';
import { ONBOARDING_STORAGE_KEY } from '../storage/storage';
import { useOnboardingState } from './useOnboardingState';

const createMemoryStorage = (): OnboardingStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    values,
  };
};

describe('useOnboardingState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces autosave and restores shared profile progress', () => {
    const storage = createMemoryStorage();
    const first = renderHook(() => useOnboardingState({
      debounceMs: 200,
      storage,
    }));

    act(() => {
      first.result.current.updateProfile({ businessName: 'Isla Nail Studio' });
    });
    expect(first.result.current.saveStatus).toBe('saving');
    expect(storage.values.has(ONBOARDING_STORAGE_KEY)).toBe(false);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(first.result.current.saveStatus).toBe('saved');
    expect(storage.values.has(ONBOARDING_STORAGE_KEY)).toBe(true);
    first.unmount();

    const restored = renderHook(() => useOnboardingState({ storage }));
    expect(restored.result.current.state.profile.businessName).toBe('Isla Nail Studio');
    expect(restored.result.current.saveStatus).toBe('saved');
  });

  it('journals the initial Welcome view and every navigation destination', () => {
    const hook = renderHook(() => useOnboardingState({ storage: createMemoryStorage() }));

    expect(hook.result.current.state.eventJournal[0]).toMatchObject({
      screen: 'welcome',
      type: 'screen_viewed',
    });

    act(() => hook.result.current.continueFlow());
    expect(hook.result.current.state.eventJournal.slice(-2).map((event) => event.type)).toEqual([
      'continue',
      'screen_viewed',
    ]);
    expect(hook.result.current.state.eventJournal.at(-1)).toMatchObject({
      screen: 'business',
      type: 'screen_viewed',
    });

    act(() => hook.result.current.continueFlow());
    act(() => hook.result.current.back());
    expect(hook.result.current.state.eventJournal.slice(-2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ nextScreen: 'business', screen: 'photo_social', type: 'back' }),
      expect.objectContaining({ screen: 'business', type: 'screen_viewed' }),
    ]));

    act(() => hook.result.current.continueFlow());
    act(() => hook.result.current.skip('photo'));
    expect(hook.result.current.state.eventJournal.slice(-2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: 'photo', screen: 'photo_social', type: 'skip' }),
      expect.objectContaining({ screen: 'location_contact', type: 'screen_viewed' }),
    ]));
  });

  it('uses actual conditional history and preserves hidden About data', () => {
    const storage = createMemoryStorage();
    const hook = renderHook(() => useOnboardingState({ storage }));

    act(() => {
      hook.result.current.updateProfile((profile) => ({
        ...profile,
        about: { ...profile.about, shortBio: 'Preserve this bio' },
      }));
      hook.result.current.viewScreen('about');
      hook.result.current.setAboutEnabled(false);
      hook.result.current.continueFlow();
    });

    expect(hook.result.current.state.progress.currentScreen).toBe('policies');
    expect(hook.result.current.state.progress.screenHistory).not.toContain('about_design');
    expect(hook.result.current.state.profile.about.shortBio).toBe('Preserve this bio');
    act(() => hook.result.current.back());
    expect(hook.result.current.state.progress.currentScreen).toBe('about');
  });

  it('saves before pausing, resumes, and resets only onboarding state', () => {
    const storage = createMemoryStorage();
    const hook = renderHook(() => useOnboardingState({ storage }));
    act(() => {
      hook.result.current.updateRecipe((recipe) => recipe);
    });
    act(() => {
      hook.result.current.viewScreen('location_contact');
    });

    act(() => {
      const result = hook.result.current.pause();
      expect(result.success).toBe(true);
    });
    expect(hook.result.current.state.progress.sessionStatus).toBe('paused');
    expect(storage.values.has(ONBOARDING_STORAGE_KEY)).toBe(true);

    act(() => hook.result.current.resume(false));
    expect(hook.result.current.state.progress.currentScreen).toBe('location_contact');
    expect(hook.result.current.state.eventJournal.at(-1)?.type).toBe('resume_after_reload');

    storage.values.set('unrelated', 'preserved');
    act(() => expect(hook.result.current.reset()).toBe(true));
    expect(hook.result.current.state.progress.currentScreen).toBe('welcome');
    expect(hook.result.current.state.eventJournal).toEqual([]);
    expect(storage.values.has(ONBOARDING_STORAGE_KEY)).toBe(false);
    expect(storage.values.get('unrelated')).toBe('preserved');
  });

  it('surfaces local storage failures', () => {
    const storage: OnboardingStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error('quota full');
      },
    };
    const hook = renderHook(() => useOnboardingState({ debounceMs: 100, storage }));
    act(() => {
      hook.result.current.updateProfile({ ownerName: 'Daniela' });
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(hook.result.current.saveStatus).toBe('error');
    expect(hook.result.current.storageIssue).toBe('quota full');
    expect(hook.result.current.state.profile.ownerName).toBe('Daniela');
  });

  it('blocks Builder handoff until all five essentials are complete', () => {
    const storage = createMemoryStorage();
    const hook = renderHook(() => useOnboardingState({ storage }));
    act(() => {
      hook.result.current.viewScreen('final_preview');
    });
    let allowed = true;
    act(() => {
      allowed = hook.result.current.requestBuilderHandoff();
    });
    expect(allowed).toBe(false);
    expect(hook.result.current.state.progress.currentScreen).toBe('business');

    act(() => {
      hook.result.current.applyFixture('all_essentials_complete');
    });
    act(() => {
      allowed = hook.result.current.requestBuilderHandoff();
    });
    expect(allowed).toBe(true);
    expect(hook.result.current.state.eventJournal.at(-1)?.type).toBe('open_builder');
  });

  it.each(['lifetime', 'monthly', 'free'] as const)(
    'persists the %s plan intent and its journal event synchronously',
    (intent) => {
      const storage = createMemoryStorage();
      const hook = renderHook(() => useOnboardingState({ storage }));

      act(() => {
        expect(hook.result.current.choosePlan(intent).success).toBe(true);
      });

      const persisted = storage.values.get(ONBOARDING_STORAGE_KEY);
      expect(persisted).toBeDefined();
      expect(JSON.parse(persisted ?? '{}')).toMatchObject({
        planOffer: { planIntent: intent },
        progress: { sessionStatus: 'builder' },
      });
      expect(hook.result.current.state.eventJournal.at(-1)).toMatchObject({
        intent,
        type: 'offer_choice',
      });
      hook.unmount();
    },
  );
});
