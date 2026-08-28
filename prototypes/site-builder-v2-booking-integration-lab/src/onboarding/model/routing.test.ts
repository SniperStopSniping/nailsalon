import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from './defaults';
import {
  getNextScreen,
  getResumeScreen,
  goBack,
  goForward,
  goToScreen,
  pauseOnboarding,
  reconcileConditionalHistory,
  resumeOnboarding,
  skipOptionalScreen,
} from './routing';

describe('onboarding conditional routing', () => {
  it('follows the normal flow without exposing a setup hub', () => {
    let state = createDefaultOnboardingState();
    const visited = [state.progress.currentScreen];
    while (getNextScreen(state.progress.currentScreen, state)) {
      state = goForward(state);
      visited.push(state.progress.currentScreen);
    }

    expect(visited).toEqual([
      'welcome',
      'business',
      'photo_social',
      'location_contact',
      'booking_preferences',
      'starter',
      'starting_preview',
      'about',
      'about_design',
      'policies',
      'site_style',
      'extras',
      'final_preview',
    ]);
  });

  it('skips About design when About is off and Back follows actual history', () => {
    let state = createDefaultOnboardingState();
    state = goToScreen(state, 'about');
    state = reconcileConditionalHistory({
      ...state,
      recipe: { ...state.recipe, aboutEnabled: false },
    });
    state = goForward(state);

    expect(state.progress.currentScreen).toBe('policies');
    expect(state.progress.screenHistory).not.toContain('about_design');
    expect(goBack(state).progress.currentScreen).toBe('about');
  });

  it('includes About design when enabled and preserves About data when disabled', () => {
    let state = createDefaultOnboardingState();
    state.profile.about.shortBio = 'This content remains stored.';
    state = goToScreen(state, 'about');
    expect(getNextScreen('about', state)).toBe('about_design');
    state = goForward(state);
    state = reconcileConditionalHistory({
      ...state,
      recipe: { ...state.recipe, aboutEnabled: false },
    });

    expect(state.progress.currentScreen).toBe('about');
    expect(state.profile.about.shortBio).toBe('This content remains stored.');
  });

  it('records optional skips without changing conditional screen ordering', () => {
    let state = goToScreen(createDefaultOnboardingState(), 'policies');
    state = skipOptionalScreen(state, 'policies');
    expect(state.progress.currentScreen).toBe('site_style');
    expect(state.progress.skippedOptionalItems).toEqual(['policies']);

    state = goToScreen(state, 'extras');
    state = skipOptionalScreen(state, 'extras');
    expect(state.progress.currentScreen).toBe('final_preview');
    expect(state.progress.skippedOptionalItems).toEqual(['policies', 'extras']);
  });

  it('pauses and resumes on the last active screen', () => {
    const active = goToScreen(createDefaultOnboardingState(), 'location_contact');
    const paused = pauseOnboarding(active);
    const resumed = resumeOnboarding(paused);

    expect(paused.progress.sessionStatus).toBe('paused');
    expect(resumed.progress.sessionStatus).toBe('active');
    expect(resumed.progress.currentScreen).toBe('location_contact');
  });

  it('redirects a final review with an incomplete essential to that screen', () => {
    const state = createDanielaFixtureState();
    state.recipe.styleConfirmed = false;
    expect(getResumeScreen(state)).toBe('site_style');
  });
});
