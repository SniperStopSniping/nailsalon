import { describe, expect, it } from 'vitest';

import { resolveRebookingPromptSettings } from './rebookingPromptSettings';

describe('resolveRebookingPromptSettings', () => {
  it('keeps existing salons off when the additive setting is absent or malformed', () => {
    expect(resolveRebookingPromptSettings(null)).toEqual({ enabled: false, intervalWeeks: 3, message: 'Secure your next spot now.' });
    expect(resolveRebookingPromptSettings({ rebookingPrompt: {} })).toEqual({ enabled: false, intervalWeeks: 3, message: 'Secure your next spot now.' });
    expect(resolveRebookingPromptSettings({ rebookingPrompt: { enabled: 'true' } })).toEqual({ enabled: false, intervalWeeks: 3, message: 'Secure your next spot now.' });
  });

  it('accepts only an explicit enabled value', () => {
    expect(resolveRebookingPromptSettings({ rebookingPrompt: { enabled: true } })).toEqual({ enabled: true, intervalWeeks: 3, message: 'Secure your next spot now.' });
    expect(resolveRebookingPromptSettings({ rebookingPrompt: { enabled: false } })).toEqual({ enabled: false, intervalWeeks: 3, message: 'Secure your next spot now.' });
  });

  it('uses stored valid recommendation copy and rejects malformed optional values', () => {
    expect(resolveRebookingPromptSettings({ rebookingPrompt: { enabled: true, intervalWeeks: 4, message: 'Reserve your preferred time.' } })).toEqual({ enabled: true, intervalWeeks: 4, message: 'Reserve your preferred time.' });
    expect(resolveRebookingPromptSettings({ rebookingPrompt: { intervalWeeks: 1.5, message: 'x'.repeat(301) } })).toEqual({ enabled: false, intervalWeeks: 3, message: 'Secure your next spot now.' });
  });
});
