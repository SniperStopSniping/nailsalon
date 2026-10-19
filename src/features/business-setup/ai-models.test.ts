import { describe, expect, it } from 'vitest';

import { isSetupModel, selectDesignModel } from './ai-models';

describe('builder model routing', () => {
  it.each(['Make the Instagram clickable', 'Make the heading smaller', 'Change the background to beige', 'Put services above the gallery.', 'Put services after the gallery.', 'Make the mobile version less crowded.', 'The big headline feels cramped. Give the letters more breathing room and make the mobile hero shorter. Keep the colours, service menu and business details unchanged.', 'Make the mobile hero shorter.', 'Give the letters more room.'])('uses Luna for a bounded saved-design edit: %s', (message) => {
    expect(selectDesignModel(message, true)).toBe('gpt-6-luna');
    expect(selectDesignModel(message, false)).toBe('gpt-6.1-sol');
  });

  it.each(['Completely redesign the hero', 'Create a new layout with pink buttons', 'Build something different', 'Add animations', 'Completely redesign mobile to be less crowded', 'Create a new layout and put services above the gallery', 'Completely redesign it with a shorter hero.', 'Rebuild the layout and give the letters more room.'])('keeps major or ambiguous design work on Sol: %s', (message) => {
    expect(selectDesignModel(message, true)).toBe('gpt-6.1-sol');
  });

  it('allows only the two approved API identifiers', () => {
    expect(isSetupModel('gpt-6-astra')).toBe(false);
    expect(isSetupModel('constructor')).toBe(false);
    expect(isSetupModel('gpt-6-luna')).toBe(true);
    expect(isSetupModel('gpt-6.1-sol')).toBe(true);
  });
});
