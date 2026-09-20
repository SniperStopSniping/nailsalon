import { describe, expect, it } from 'vitest';

import { resolveRebookingPromptSettings } from './rebookingPromptSettings';

describe('resolveRebookingPromptSettings', () => {
  it('keeps existing salons off when the additive setting is absent or malformed', () => {
    expect(resolveRebookingPromptSettings(null)).toEqual({ enabled: false });
    expect(resolveRebookingPromptSettings({ rebookingPrompt: {} })).toEqual({ enabled: false });
    expect(resolveRebookingPromptSettings({ rebookingPrompt: { enabled: 'true' } })).toEqual({ enabled: false });
  });

  it('accepts only an explicit enabled value', () => {
    expect(resolveRebookingPromptSettings({ rebookingPrompt: { enabled: true } })).toEqual({ enabled: true });
    expect(resolveRebookingPromptSettings({ rebookingPrompt: { enabled: false } })).toEqual({ enabled: false });
  });
});
