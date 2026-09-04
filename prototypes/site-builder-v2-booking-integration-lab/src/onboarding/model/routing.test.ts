import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from './defaults';
import {
  getNextScreen,
  getResumeScreen,
  goBack,
  goForward,
  goToBrowserHistoryScreen,
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
      'starter',
      'business',
      'starting_preview',
      'location_contact',
      'hours',
      'site_style',
      'save_progress',
      'booking_preferences',
      'about',
      'about_design',
      'policies',
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

  it('routes Quick Book through its layout selector when About is off', () => {
    let state = createDefaultOnboardingState();
    state.recipe.starter = 'quick_book';
    state.recipe.aboutEnabled = false;
    state = goToScreen(state, 'about');

    expect(getNextScreen('about', state)).toBe('about_design');

    state = goForward(state);

    expect(state.progress.currentScreen).toBe('about_design');

    state = reconcileConditionalHistory(state);

    expect(state.progress.currentScreen).toBe('about_design');
    expect(state.progress.screenHistory).toEqual([
      'starter',
      'about',
      'about_design',
    ]);
  });

  it('routes Quick Book through site layout, policies, booking layout and final preview only', () => {
    let state = createDefaultOnboardingState();
    state.recipe.starter = 'quick_book';
    state.recipe.aboutEnabled = false;
    const visited = [state.progress.currentScreen];
    while (getNextScreen(state.progress.currentScreen, state)) {
      state = goForward(state);
      visited.push(state.progress.currentScreen);
    }

    expect(visited).toEqual([
      'starter',
      'business',
      'starting_preview',
      'location_contact',
      'hours',
      'site_style',
      'save_progress',
      'booking_preferences',
      'about',
      'about_design',
      'policies',
      'booking_layout',
      'final_preview',
    ]);
  });

  it('moves a persisted Quick Book Extras screen into the new Booking layout step', () => {
    const state = createDefaultOnboardingState();
    state.recipe.starter = 'quick_book';
    state.progress.currentScreen = 'extras';
    state.progress.lastActiveScreen = 'extras';
    state.progress.screenHistory = ['starter', 'policies', 'extras'];
    state.progress.visitedScreens = ['starter', 'policies', 'extras'];

    const reconciled = reconcileConditionalHistory(state);

    expect(reconciled.progress.currentScreen).toBe('booking_layout');
    expect(reconciled.progress.lastActiveScreen).toBe('booking_layout');
    expect(reconciled.progress.screenHistory).toEqual([
      'starter',
      'policies',
      'booking_layout',
    ]);
    expect(reconciled.progress.visitedScreens).not.toContain('extras');
    expect(getNextScreen(reconciled.progress.currentScreen, reconciled)).toBe('final_preview');
  });

  it('removes a Quick Book-only Booking layout step after switching website type', () => {
    const state = createDefaultOnboardingState();
    state.recipe.starter = 'one_page';
    state.progress.currentScreen = 'booking_layout';
    state.progress.lastActiveScreen = 'booking_layout';
    state.progress.screenHistory = ['starter', 'policies', 'booking_layout'];

    const reconciled = reconcileConditionalHistory(state);

    expect(reconciled.progress.currentScreen).toBe('final_preview');
    expect(reconciled.progress.lastActiveScreen).toBe('final_preview');
    expect(reconciled.progress.screenHistory).toEqual([
      'starter',
      'policies',
      'final_preview',
    ]);
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

  it('reconciles repeated browser Back and Forward without inventing About design when About is off', () => {
    let state = createDefaultOnboardingState();
    state = goToScreen(state, 'about');
    state = reconcileConditionalHistory({
      ...state,
      recipe: { ...state.recipe, aboutEnabled: false },
    });
    state = goToScreen(state, 'policies');

    for (let cycle = 0; cycle < 3; cycle += 1) {
      state = goToBrowserHistoryScreen(state, 'about', 'back');

      expect(state.progress.currentScreen).toBe('about');
      expect(state.progress.screenHistory).toEqual(['starter', 'about']);

      const hiddenAboutDesign = goToBrowserHistoryScreen(state, 'about_design', 'forward');

      expect(hiddenAboutDesign).toBe(state);

      state = goToBrowserHistoryScreen(state, 'policies', 'forward');

      expect(state.progress.currentScreen).toBe('policies');
      expect(state.progress.screenHistory).toEqual(['starter', 'about', 'policies']);
    }
  });

  it('rebuilds the represented About On stack across repeated Back, Back, Forward, Forward cycles', () => {
    let state = createDefaultOnboardingState();
    state = goToScreen(state, 'about');
    state = goForward(state);
    state = goForward(state);

    expect(state.progress.screenHistory).toEqual([
      'starter',
      'about',
      'about_design',
      'policies',
    ]);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      state = goToBrowserHistoryScreen(state, 'about_design', 'back');

      expect(state.progress.screenHistory).toEqual([
        'starter',
        'about',
        'about_design',
      ]);

      state = goToBrowserHistoryScreen(state, 'about', 'back');

      expect(state.progress.screenHistory).toEqual(['starter', 'about']);

      state = goToBrowserHistoryScreen(state, 'about_design', 'forward');

      expect(state.progress.screenHistory).toEqual([
        'starter',
        'about',
        'about_design',
      ]);

      state = goToBrowserHistoryScreen(state, 'policies', 'forward');

      expect(state.progress.screenHistory).toEqual([
        'starter',
        'about',
        'about_design',
        'policies',
      ]);
    }
  });

  it('records optional skips without changing conditional screen ordering', () => {
    let state = goToScreen(createDefaultOnboardingState(), 'policies');
    state = skipOptionalScreen(state, 'policies');

    expect(state.progress.currentScreen).toBe('extras');
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
