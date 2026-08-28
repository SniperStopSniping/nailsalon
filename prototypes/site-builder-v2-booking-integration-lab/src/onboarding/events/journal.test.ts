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
});
