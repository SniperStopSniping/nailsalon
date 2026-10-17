import { describe, expect, it } from 'vitest';

import { isSetupModel, selectDesignModel } from './ai-models';

describe('builder model routing', () => {
  it.each(['Make the Instagram clickable', 'Make the heading smaller', 'Change the background to beige', 'Put services above the gallery.', 'Put services after the gallery.', 'Make the mobile version less crowded.'])('uses Luna for a bounded saved-design edit: %s', (message) => {
    expect(selectDesignModel(message, true)).toBe('gpt-6-luna');
    expect(selectDesignModel(message, false)).toBe('gpt-6.1-sol');
  });

  it.each(['Completely redesign the hero', 'Create a new layout with pink buttons', 'Build something different', 'Add animations', 'Completely redesign mobile to be less crowded', 'Create a new layout and put services above the gallery'])('keeps major or ambiguous design work on Sol: %s', (message) => {
    expect(selectDesignModel(message, true)).toBe('gpt-6.1-sol');
  });

  it('allows only the two approved API identifiers', () => {
    expect(isSetupModel('gpt-6-astra')).toBe(false);
    expect(isSetupModel('constructor')).toBe(false);
    expect(isSetupModel('gpt-6-luna')).toBe(true);
    expect(isSetupModel('gpt-6.1-sol')).toBe(true);
  });
});
