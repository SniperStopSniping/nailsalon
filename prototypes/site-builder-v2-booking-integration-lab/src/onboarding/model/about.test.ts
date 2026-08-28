import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import {
  buildAboutWordingSuggestion,
  formatAboutListInput,
  parseAboutListInput,
} from './about';

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
