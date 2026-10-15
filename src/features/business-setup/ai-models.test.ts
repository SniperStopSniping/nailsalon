import { describe, expect, it } from 'vitest';

import { isSetupModel, selectDesignModel } from './ai-models';

describe('builder model routing', () => {
  it.each(['Make the Instagram clickable', 'Make the heading smaller', 'Change the background to beige'])('uses Luna for a bounded saved-design edit: %s', (message) => {
    expect(selectDesignModel(message, true)).toBe('gpt-6-luna');
    expect(selectDesignModel(message, false)).toBe('gpt-6.1-sol');
  });

  it.each(['Completely redesign the hero', 'Create a new layout with pink buttons', 'Build something different', 'Add animations'])('keeps major or ambiguous design work on Sol: %s', (message) => {
    expect(selectDesignModel(message, true)).toBe('gpt-6.1-sol');
  });

  it('allows only the two approved API identifiers', () => {
    expect(isSetupModel('gpt-6-astra')).toBe(false);
    expect(isSetupModel('constructor')).toBe(false);
    expect(isSetupModel('gpt-6-luna')).toBe(true);
    expect(isSetupModel('gpt-6.1-sol')).toBe(true);
  });
});
