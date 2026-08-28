import type {
  OnboardingEvent,
  OnboardingEventInput,
  OnboardingLabState,
} from '../model/types';

export const MAX_ONBOARDING_EVENT_ENTRIES = 2_000;

export type JournalOptions = {
  idFactory?: () => string;
  maxEntries?: number;
  timestamp?: string;
};

const createEventId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `event_${globalThis.crypto.randomUUID()}`;
  }
  return `event_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

const safeFieldIds = (fieldIds: readonly string[]): string[] => [...new Set(
  fieldIds
    .map((fieldId) => fieldId.trim())
    .filter((fieldId) => /^[a-z0-9_.-]{1,80}$/i.test(fieldId)),
)].slice(0, 30);

/**
 * Rebuild every event from its allow-listed discriminant so accidental form
 * values or arbitrary metadata can never enter the local usability journal.
 */
export const sanitizeOnboardingEvent = (
  event: OnboardingEventInput,
): OnboardingEventInput => {
  switch (event.type) {
    case 'screen_viewed':
      return { screen: event.screen, type: event.type };
    case 'continue':
      return { nextScreen: event.nextScreen, screen: event.screen, type: event.type };
    case 'back':
      return { nextScreen: event.nextScreen, screen: event.screen, type: event.type };
    case 'skip':
      return { item: event.item, screen: event.screen, type: event.type };
    case 'about_toggled':
    case 'policies_toggled':
      return { enabled: event.enabled, type: event.type };
    case 'preset_changed':
      return {
        presetId: event.presetId,
        presetKind: event.presetKind,
        type: event.type,
      };
    case 'preview_opened':
    case 'preview_closed':
      return { source: event.source, type: event.type };
    case 'starter_selected':
      return { starter: event.starter, type: event.type };
    case 'extras_selected':
      return { extras: [...new Set(event.extras)], type: event.type };
    case 'open_builder':
    case 'reset':
      return { type: event.type };
    case 'offer_choice':
      return { intent: event.intent, type: event.type };
    case 'validation_failure':
      return {
        fieldIds: safeFieldIds(event.fieldIds),
        screen: event.screen,
        type: event.type,
      };
    case 'resume_after_reload':
    case 'paused':
      return { screen: event.screen, type: event.type };
  }

  const exhaustive: never = event;
  return exhaustive;
};

export const appendOnboardingEvent = (
  journal: readonly OnboardingEvent[],
  input: OnboardingEventInput,
  options: JournalOptions = {},
): OnboardingEvent[] => {
  const event: OnboardingEvent = {
    ...sanitizeOnboardingEvent(input),
    id: options.idFactory?.() ?? createEventId(),
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
  const maximum = options.maxEntries ?? MAX_ONBOARDING_EVENT_ENTRIES;
  return [...journal, event].slice(-Math.max(0, maximum));
};

export const recordOnboardingEvent = (
  state: OnboardingLabState,
  input: OnboardingEventInput,
  options?: JournalOptions,
): OnboardingLabState => ({
  ...state,
  eventJournal: appendOnboardingEvent(state.eventJournal, input, options),
});

export const exportOnboardingEventJournal = (
  journal: readonly OnboardingEvent[],
  exportedAt = new Date().toISOString(),
): string => JSON.stringify({
  events: journal,
  exportedAt,
  kind: 'luster-onboarding-v1-lab-event-journal',
  version: 1,
}, null, 2);
