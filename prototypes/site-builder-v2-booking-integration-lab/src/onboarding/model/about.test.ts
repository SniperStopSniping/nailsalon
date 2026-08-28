import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import {
  ABOUT_ELEMENT_IDS,
  ABOUT_PRESET_CAPABILITIES,
  aboutPresetSupportsElement,
  buildAboutWordingSuggestion,
  formatAboutListInput,
  parseAboutListInput,
} from './about';
import type { AboutPresetId } from './types';

describe('About profile editing helpers', () => {
  it('parses comma, semicolon, and newline separators only when called', () => {
    const raw = 'Advanced Russian, BIAB;\nGel-X\r\n  Structured   Gel  ';

    expect(parseAboutListInput(raw)).toEqual([
      'Advanced Russian',
      'BIAB',
      'Gel-X',
      'Structured Gel',
    ]);
    expect(formatAboutListInput(['English', 'Spanish'])).toBe('English, Spanish');
    expect(raw).toBe('Advanced Russian, BIAB;\nGel-X\r\n  Structured   Gel  ');
  });

  it('creates a deterministic, personalized first-person suggestion', () => {
    const profile = createDanielaFixtureState().profile;

    const first = buildAboutWordingSuggestion(profile);
    const second = buildAboutWordingSuggestion(structuredClone(profile));

    expect(second).toBe(first);
    expect(first).toMatch(/^I’m Daniela,/u);
    expect(first).toContain('Isla Nail Studio');
    expect(first).toContain('Russian Manicure');
    expect(first).toContain('Scarborough, Ontario');
    expect(first).not.toMatch(/\bDaniela creates\b/u);
  });
});

describe('About preset capability contract', () => {
  it('requires every preset to support every enabled About element', () => {
    const presets = Object.keys(ABOUT_PRESET_CAPABILITIES) as AboutPresetId[];

    expect(presets).toEqual([
      'about_before_you_book',
      'editorial_portrait',
      'photo_right',
      'profile_quick_facts',
    ]);
    expect(ABOUT_ELEMENT_IDS).toHaveLength(13);
    for (const preset of presets) {
      expect(Object.keys(ABOUT_PRESET_CAPABILITIES[preset].elements))
        .toEqual([...ABOUT_ELEMENT_IDS]);
      for (const element of ABOUT_ELEMENT_IDS) {
        expect(aboutPresetSupportsElement(preset, element)).toBe(true);
      }
    }
  });
});
