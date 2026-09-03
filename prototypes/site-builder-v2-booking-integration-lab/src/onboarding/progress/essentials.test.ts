import { describe, expect, it } from 'vitest';

import { SCREEN_METADATA } from '../copy';
import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from '../model/defaults';
import {
  canOpenBuilder,
  getCompletedEssentialIds,
  getCompletedEssentialStages,
  getEssentialResults,
  getEssentialsLeft,
  getEssentialsMessage,
  getFirstIncompleteEssentialScreen,
  getStageEssentialProgress,
} from './essentials';

describe('onboarding essentials', () => {
  it('defines exactly five essentials and keeps optional content out', () => {
    const state = createDefaultOnboardingState();

    expect(getEssentialResults(state)).toHaveLength(5);
    expect(getEssentialsMessage(state)).toBe('5 required steps left');

    state.profile.profilePhoto = {
      fileName: 'portrait.webp',
      id: 'fixture-portrait',
      mimeType: 'image/webp',
      source: 'fixture',
    };
    state.profile.about.shortBio = 'Optional bio';
    state.recipe.aboutEnabled = true;
    state.recipe.galleryEnabled = true;
    state.recipe.canvaEnabled = true;

    expect(getEssentialsLeft(state)).toBe(5);
  });

  it('computes every completion rule from the shared state', () => {
    const state = createDanielaFixtureState();

    expect(getCompletedEssentialIds(state)).toEqual([
      'starting_point',
      'business',
      'location_contact',
      'booking_preferences',
      'site_style',
    ]);
    expect(getEssentialsMessage(state)).toBe('All required steps complete');
    expect(getFirstIncompleteEssentialScreen(state)).toBeNull();
    expect(canOpenBuilder(state)).toBe(true);
  });

  it('accepts Booking-only contact explicitly', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Isla Nail Studio';
    state.profile.businessType = 'independent_salon';
    state.profile.ownerName = 'Daniela';
    state.profile.businessStructure = 'solo';
    state.profile.location.cityOrArea = 'Scarborough, Ontario';
    state.profile.location.exactAddress = '880 Ellesmere Rd';
    state.profile.location.locationType = 'salon_suite';
    state.profile.bookingOnlyContact = true;

    expect(getCompletedEssentialIds(state)).toEqual([
      'business',
      'location_contact',
    ]);
  });

  it('requires an enabled, coherent preferred contact method when not Booking-only', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessType = 'independent_salon';
    state.profile.location.cityOrArea = 'Scarborough, Ontario';
    state.profile.location.exactAddress = '880 Ellesmere Rd';
    state.profile.location.locationType = 'salon_suite';
    state.profile.bookingOnlyContact = false;
    state.profile.clientContact.primaryNumber = '416-555-0100';
    state.profile.preferredContact = 'call';

    expect(getCompletedEssentialIds(state)).not.toContain('location_contact');

    state.profile.clientContact.callEnabled = true;

    expect(getCompletedEssentialIds(state)).toContain('location_contact');

    state.profile.clientContact.callEnabled = false;
    state.profile.clientContact.textEnabled = true;

    expect(getCompletedEssentialIds(state)).not.toContain('location_contact');

    state.profile.preferredContact = 'text';

    expect(getCompletedEssentialIds(state)).toContain('location_contact');
  });

  it('requires a real starter reference and explicit style confirmation', () => {
    const state = createDanielaFixtureState();
    state.recipe.starterDocumentSiteId = null;
    state.recipe.styleConfirmed = false;

    expect(getEssentialsLeft(state)).toBe(2);
    expect(getEssentialsMessage(state)).toBe('2 required steps left');
    expect(getFirstIncompleteEssentialScreen(state)).toBe('starter');
    expect(canOpenBuilder(state)).toBe(false);
  });

  it('reports stage completion without counting screens', () => {
    const state = createDanielaFixtureState();

    expect(getStageEssentialProgress(state, 'basics')).toEqual({
      complete: 3,
      stageComplete: true,
      total: 3,
    });
    expect(getStageEssentialProgress(state, 'review').stageComplete).toBe(true);
    expect(JSON.stringify(SCREEN_METADATA)).not.toMatch(/step\s+\d+\s+of\s+\d+/i);
  });

  it('does not complete Design in Review when its essential is still missing', () => {
    const state = createDanielaFixtureState();
    state.progress.currentScreen = 'final_preview';
    state.recipe.styleConfirmed = false;

    expect(getCompletedEssentialStages(state)).toEqual(['basics', 'booking']);
    expect(getStageEssentialProgress(state, 'design')).toEqual({
      complete: 0,
      stageComplete: false,
      total: 1,
    });
    expect(getStageEssentialProgress(state, 'review').stageComplete).toBe(false);
  });
});
