import { describe, expect, it } from 'vitest';

import { initializeStarter } from '../../model';
import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from '../model/defaults';
import {
  getBuilderPrimaryLabel,
  getNeedsAttentionItems,
  getReadinessItems,
} from './readiness';

describe('onboarding readiness contact metadata', () => {
  it('marks contact ready only for a coherent public method or Booking-only choice', () => {
    const state = createDefaultOnboardingState();
    state.profile.bookingOnlyContact = false;
    state.profile.clientContact.primaryNumber = '416-555-0100';
    state.profile.preferredContact = 'call';
    expect(getReadinessItems(state, null).some((item) => item.id === 'contact')).toBe(false);

    state.profile.clientContact.callEnabled = true;
    expect(getReadinessItems(state, null)).toContainEqual({
      id: 'contact',
      label: 'Contact and privacy',
      status: 'ready',
    });

    state.profile.clientContact.callEnabled = false;
    state.profile.bookingOnlyContact = true;
    expect(getReadinessItems(state, null)).toContainEqual({
      id: 'contact',
      label: 'Contact and privacy',
      status: 'ready',
    });
  });

  it('does not mark malformed Instagram configured and accepts a normalized profile URL', () => {
    const state = createDefaultOnboardingState();
    state.profile.instagram = 'instagram.com/isla/reels';
    expect(getReadinessItems(state, null).some((item) => item.id === 'contact'))
      .toBe(false);

    state.profile.bookingOnlyContact = false;
    state.profile.preferredContact = 'instagram';
    expect(getReadinessItems(state, null).some((item) => item.id === 'contact'))
      .toBe(false);

    state.profile.instagram = 'https://www.instagram.com/islanailstudio/';
    expect(getReadinessItems(state, null)).toContainEqual({
      id: 'contact',
      label: 'Contact and privacy',
      status: 'ready',
    });
  });

  it('clears Add policies after meaningful content is saved and names a hidden saved state', () => {
    const state = createDefaultOnboardingState();
    state.recipe.policiesEnabled = false;
    expect(getReadinessItems(state, null)).toContainEqual({
      id: 'policies',
      label: 'Add policies',
      screen: 'policies',
      status: 'recommended',
    });

    state.profile.policies.cancellations.notice = '24_hours';
    state.profile.policies.cancellations.consequence = 'cancellation_fee';
    state.recipe.policiesEnabled = true;
    expect(getReadinessItems(state, null).some((item) => item.id === 'policies'))
      .toBe(false);

    state.recipe.policiesEnabled = false;
    expect(getReadinessItems(state, null)).toContainEqual({
      detail: 'Your policy answers are saved, but not shown on your site.',
      id: 'policies',
      label: 'Show saved policies',
      screen: 'policies',
      status: 'recommended',
    });
  });

  it('keeps an enabled About section directly editable from final review', () => {
    const state = createDanielaFixtureState();
    const items = getReadinessItems(state, initializeStarter('one_page'));

    expect(items).toContainEqual({
      id: 'about',
      label: 'About section',
      screen: 'about',
      status: 'ready',
    });
  });

  it('routes a disabled About recommendation directly to the About screen', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutEnabled = false;
    const items = getReadinessItems(state, initializeStarter('one_page'));

    expect(items).toContainEqual({
      id: 'about',
      label: 'Add About',
      screen: 'about',
      status: 'recommended',
    });
  });

  it.each([
    ['missing', 'Replace'],
    ['error', 'Replace'],
    ['loading', 'Review'],
  ] as const)('blocks Builder handoff for a %s Custom Design asset with a truthful owner action', (status, actionLabel) => {
    const state = createDanielaFixtureState();
    const document = initializeStarter('one_page');
    const asset = {
      assetId: 'asset-canva-page-2',
      fileName: 'canva-page-2.png',
      status,
    };

    const issue = getNeedsAttentionItems(state, document, [asset]).find(
      (item) => item.id === 'canva-asset-asset-canva-page-2',
    );

    expect(issue).toEqual({
      actionLabel,
      detail: status === 'loading'
        ? 'We’re checking that this uploaded page is available in this browser.'
        : 'This uploaded page is unavailable. Its image and links stay hidden until you replace it.',
      id: 'canva-asset-asset-canva-page-2',
      label: status === 'loading'
        ? 'Checking canva-page-2.png'
        : 'canva-page-2.png needs attention',
      screen: 'extras',
      status: 'needs_attention',
    });
    expect(getBuilderPrimaryLabel(state, document, [asset])).toBe('Resolve 1 issue');
  });
});
