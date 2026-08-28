import { describe, expect, it, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from '../model/defaults';
import {
  clearOnboardingState,
  loadOnboardingState,
  ONBOARDING_STORAGE_KEY,
  parseOnboardingState,
  saveOnboardingState,
  type OnboardingStorage,
} from './storage';

const createMemoryStorage = (
  initial: Record<string, string> = {},
): OnboardingStorage & { values: Map<string, string> } => {
  const values = new Map(Object.entries(initial));
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

describe('onboarding browser-local storage', () => {
  it('uses one namespaced key and round-trips the complete state', () => {
    const storage = createMemoryStorage({ unrelated: 'keep me' });
    const state = createDanielaFixtureState();
    state.recipe.aboutEnabled = false;
    state.planOffer.fixtureState = 'expiring';

    const saved = saveOnboardingState(state, {
      storage,
      timestamp: '2026-08-27T14:00:00.000Z',
    });
    expect(saved.success).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      'luster:onboarding-v1-lab',
      expect.any(String),
    );
    expect(ONBOARDING_STORAGE_KEY).toBe('luster:onboarding-v1-lab');

    const loaded = loadOnboardingState(storage);
    expect(loaded.status).toBe('loaded');
    expect(loaded.state.profile.about.shortBio).toBe(state.profile.about.shortBio);
    expect(loaded.state.recipe.aboutEnabled).toBe(false);
    expect(loaded.state.planOffer.fixtureState).toBe('expiring');
    expect(loaded.state.progress.lastSavedAt).toBe('2026-08-27T14:00:00.000Z');
    expect(storage.values.get('unrelated')).toBe('keep me');
  });

  it('fails visibly for malformed or unsupported saved state', () => {
    expect(parseOnboardingState('{bad').status).toBe('error');
    expect(parseOnboardingState(JSON.stringify({
      ...createDefaultOnboardingState(),
      schemaVersion: 999,
    })).status).toBe('error');
  });

  it('reports storage failures without discarding in-memory state', () => {
    const state = createDefaultOnboardingState();
    const failingStorage: OnboardingStorage = {
      getItem: () => {
        throw new Error('read blocked');
      },
      removeItem: () => {
        throw new Error('remove blocked');
      },
      setItem: () => {
        throw new Error('quota full');
      },
    };

    expect(loadOnboardingState(failingStorage)).toMatchObject({
      message: 'read blocked',
      status: 'error',
    });
    expect(saveOnboardingState(state, { storage: failingStorage })).toEqual({
      message: 'quota full',
      success: false,
    });
    expect(clearOnboardingState(failingStorage)).toEqual({
      message: 'remove blocked',
      success: false,
    });
  });

  it('reset removes only onboarding state', () => {
    const storage = createMemoryStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify(createDefaultOnboardingState()),
      unrelated: 'preserved',
    });
    expect(clearOnboardingState(storage)).toEqual({ success: true });
    expect(storage.values.has(ONBOARDING_STORAGE_KEY)).toBe(false);
    expect(storage.values.get('unrelated')).toBe('preserved');
  });
});
