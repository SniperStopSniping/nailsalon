import { describe, expect, it } from 'vitest';

import { initializeStarter } from '../../../model/starters';
import { createDanielaFixtureState } from '../../fixtures';
import { loadOnboardingState, saveOnboardingState } from '../../storage/storage';
import {
  LAB_DASHBOARD_HANDOFF_PORT,
  LAB_DASHBOARD_TOUR_PORT,
  LAB_SETUP_CHECKLIST_PORT,
} from './createLabDashboardPorts';

describe('Lab dashboard ports', () => {
  it('describes the future authenticated handoff without importing it', () => {
    expect(LAB_DASHBOARD_HANDOFF_PORT).toMatchObject({
      authenticatedProductionPath: '/[locale]/admin',
      kind: 'ux_lab_storyboard',
    });
    expect(LAB_DASHBOARD_HANDOFF_PORT.getInitialDestination()).toBe('today');
  });

  it('reactivates and restores the final Review through the shared onboarding route state', () => {
    const state = createDanielaFixtureState();
    state.progress.currentScreen = 'extras';
    state.progress.lastActiveScreen = 'extras';
    state.progress.sessionStatus = 'dashboard';
    const restored = LAB_DASHBOARD_HANDOFF_PORT.prepareOnboardingReview(state);

    expect(restored.progress).toMatchObject({
      currentScreen: 'final_preview',
      lastActiveScreen: 'final_preview',
      sessionStatus: 'active',
    });
    expect(restored.progress.screenHistory.at(-1)).toBe('final_preview');
    expect(restored.profile).toEqual(state.profile);
    expect(restored.planOffer).toEqual(state.planOffer);
  });

  it('persists the restored Review so a reload resumes with an active final screen', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key); },
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const state = createDanielaFixtureState();
    state.progress.sessionStatus = 'dashboard';
    const review = LAB_DASHBOARD_HANDOFF_PORT.prepareOnboardingReview(state);

    expect(saveOnboardingState(review, { storage }).success).toBe(true);
    expect(loadOnboardingState(storage)).toMatchObject({
      state: {
        progress: {
          currentScreen: 'final_preview',
          lastActiveScreen: 'final_preview',
          sessionStatus: 'active',
        },
      },
      status: 'loaded',
    });
  });

  it('keeps the five-part tour optional and bounded', () => {
    expect(LAB_DASHBOARD_TOUR_PORT.getSteps().map((step) => step.id)).toEqual([
      'today', 'calendar', 'clients', 'services', 'website',
    ]);
  });

  it('derives site, Booking, and service status while using fixtures for integrations', () => {
    const document = initializeStarter('one_page', { siteName: 'Isla Nail Studio' });
    const items = LAB_SETUP_CHECKLIST_PORT.getItems({
      document,
      fixtures: {
        googleCalendar: 'not_connected',
        payments: 'needs_attention',
        shareBookingLink: 'connected',
      },
      selectedServiceIds: ['svc-manicure-russian'],
    });
    expect(items.find((item) => item.id === 'website_created')?.status).toBe('complete');
    expect(items.find((item) => item.id === 'booking_ready')?.status).toBe('complete');
    expect(items.find((item) => item.id === 'services_added')?.status).toBe('complete');
    expect(items.find((item) => item.id === 'google_calendar')).toMatchObject({
      source: 'lab_integration_fixture',
      status: 'not_connected',
    });
  });

  it('does not report document-backed checklist items as ready without their sources', () => {
    const items = LAB_SETUP_CHECKLIST_PORT.getItems({
      document: null,
      fixtures: {
        googleCalendar: 'connected',
        payments: 'not_connected',
        shareBookingLink: 'needs_attention',
      },
      selectedServiceIds: [],
    });

    expect(items.find((item) => item.id === 'website_created')?.status).toBe('needs_attention');
    expect(items.find((item) => item.id === 'booking_ready')?.status).toBe('needs_attention');
    expect(items.find((item) => item.id === 'services_added')?.status).toBe('needs_attention');
    expect(items.find((item) => item.id === 'google_calendar')?.status).toBe('connected');
    expect(items.every((item) => item.destination.length > 0)).toBe(true);
  });
});
