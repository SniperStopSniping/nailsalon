import { describe, expect, it } from 'vitest';

import { createDefaultOnboardingState } from '../model/defaults';
import type { OnboardingEventInput } from '../model/types';
import {
  appendOnboardingEvent,
  exportOnboardingEventJournal,
  recordOnboardingEvent,
} from './journal';

describe('local onboarding event journal', () => {
  it('records allow-listed interaction metadata without field values', () => {
    const unsafeInput = {
      fieldIds: ['businessName', 'invalid field value', 'ownerName'],
      profileValue: 'Isla Nail Studio',
      screen: 'business',
      type: 'validation_failure',
    } as OnboardingEventInput & { profileValue: string };
    const journal = appendOnboardingEvent([], unsafeInput, {
      idFactory: () => 'event-1',
      timestamp: '2026-08-27T12:00:00.000Z',
    });

    expect(journal).toEqual([{
      fieldIds: ['businessName', 'ownerName'],
      id: 'event-1',
      screen: 'business',
      timestamp: '2026-08-27T12:00:00.000Z',
      type: 'validation_failure',
    }]);
    expect(JSON.stringify(journal)).not.toContain('Isla Nail Studio');
  });

  it('caps the journal and exports portable JSON', () => {
    let state = createDefaultOnboardingState();
    state = recordOnboardingEvent(state, {
      screen: 'welcome',
      type: 'screen_viewed',
    }, {
      idFactory: () => 'event-welcome',
      maxEntries: 1,
      timestamp: '2026-08-27T12:00:00.000Z',
    });
    state = recordOnboardingEvent(state, {
      screen: 'welcome',
      type: 'paused',
    }, {
      idFactory: () => 'event-paused',
      maxEntries: 1,
      timestamp: '2026-08-27T12:01:00.000Z',
    });

    expect(state.eventJournal.map((event) => event.id)).toEqual(['event-paused']);
    const exported = JSON.parse(exportOnboardingEventJournal(
      state.eventJournal,
      '2026-08-27T13:00:00.000Z',
    )) as { events: unknown[]; kind: string };
    expect(exported.kind).toBe('luster-onboarding-v1-lab-event-journal');
    expect(exported.events).toHaveLength(1);
  });

  it('sanitizes the About wording helper event without retaining bio text', () => {
    const unsafeInput = {
      action: 'used',
      bioValue: 'Sensitive draft biography',
      suggestion: 'Generated private wording',
      type: 'about_wording_helper',
    } as OnboardingEventInput & { bioValue: string; suggestion: string };

    const journal = appendOnboardingEvent([], unsafeInput, {
      idFactory: () => 'event-helper',
      timestamp: '2026-08-28T10:00:00.000Z',
    });

    expect(journal).toEqual([{
      action: 'used',
      id: 'event-helper',
      timestamp: '2026-08-28T10:00:00.000Z',
      type: 'about_wording_helper',
    }]);
    expect(JSON.stringify(journal)).not.toContain('Sensitive draft biography');
    expect(JSON.stringify(journal)).not.toContain('Generated private wording');
  });

  it('keeps account-save analytics non-sensitive and allow-listed', () => {
    const input = {
      address: '123 Private Street',
      email: 'daniela@example.com',
      presetId: 'black_champagne',
      type: 'palette_selected',
    } as OnboardingEventInput & { address: string; email: string };

    const journal = appendOnboardingEvent([], input, {
      idFactory: () => 'event-palette',
      timestamp: '2026-08-30T10:00:00.000Z',
    });

    expect(journal).toEqual([{
      id: 'event-palette',
      presetId: 'black_champagne',
      timestamp: '2026-08-30T10:00:00.000Z',
      type: 'palette_selected',
    }]);
    expect(JSON.stringify(journal)).not.toContain('daniela@example.com');
    expect(JSON.stringify(journal)).not.toContain('123 Private Street');
  });
});
