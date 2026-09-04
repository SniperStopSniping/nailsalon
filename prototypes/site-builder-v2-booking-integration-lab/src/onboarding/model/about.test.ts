import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import {
  ABOUT_ELEMENT_IDS,
  ABOUT_PRESET_CAPABILITIES,
  aboutPresetSupportsElement,
  buildAboutWordingSuggestion,
  formatAboutListInput,
  parseAboutListInput,
  resolveAboutBio,
} from './about';
import { createDefaultBusinessProfile } from './defaults';
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

  it.each(['Polished Studio', ''])('excludes a hidden internal owner name with business name "%s"', (businessName) => {
    const profile = createDefaultBusinessProfile();
    profile.ownerName = 'Private Owner Maya';
    profile.businessName = businessName;
    profile.about.visibility.owner_name = false;
    const original = structuredClone(profile);

    const suggestion = buildAboutWordingSuggestion(profile);

    expect(suggestion).not.toContain('Private Owner Maya');
    expect(suggestion).not.toMatch(/Daniela|Isla/u);
    expect(suggestion).toContain(businessName
      ? `I’m the nail artist behind ${businessName}.`
      : 'I’m an independent nail artist.');
    expect(profile).toEqual(original);
  });

  it('resolves short and full biographies without discarding the longer story', () => {
    expect(resolveAboutBio('A short introduction.', 'My complete story.')).toEqual({
      expanded: 'My complete story.',
      lead: 'A short introduction.',
      source: 'short_and_full',
    });
    expect(resolveAboutBio('A short introduction.', '')).toEqual({
      expanded: null,
      lead: 'A short introduction.',
      source: 'short_only',
    });
    expect(resolveAboutBio('', '')).toEqual({
      expanded: null,
      lead: null,
      source: 'none',
    });
  });

  it('derives a readable lead when only a long full bio exists', () => {
    const fullBio = [
      'I built my studio around calm, detailed appointments.',
      'Every service starts with a thoughtful consultation and careful prep.',
      'I want clients to leave feeling looked after and confident in their nails.',
    ].join(' ');

    const resolved = resolveAboutBio('', fullBio);

    expect(resolved.source).toBe('full_only');
    expect(resolved.lead).toBe('I built my studio around calm, detailed appointments.');
    expect(resolved.expanded).toBe(fullBio);
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
