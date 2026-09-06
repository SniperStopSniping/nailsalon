import { describe, expect, it } from 'vitest';

import {
  buildInstagramProfileUrl,
  formatInstagramHandle,
  resolveInstagramInput,
  toInstagramHandle,
} from './instagramHandle';

describe('instagramHandle', () => {
  describe('resolveInstagramInput', () => {
    it.each([
      ['bare handle', 'audit0905lacquer'],
      ['@ handle', '@audit0905lacquer'],
      ['profile url', 'https://www.instagram.com/audit0905lacquer/'],
      ['profile url without www', 'https://instagram.com/audit0905lacquer'],
      ['padded handle', '  audit0905lacquer  '],
    ])('resolves a %s to one canonical stored URL', (_label, input) => {
      const resolution = resolveInstagramInput(input);

      expect(resolution.status).toBe('resolved');
      expect(resolution.username).toBe('audit0905lacquer');
      expect(resolution.url).toBe('https://www.instagram.com/audit0905lacquer/');
    });

    it.each([null, undefined, '', '   '])('treats %s as empty, not invalid', (input) => {
      expect(resolveInstagramInput(input).status).toBe('empty');
    });

    it.each([
      ['another host', 'https://example.com/audit0905lacquer'],
      ['a deep link', 'https://www.instagram.com/audit0905lacquer/reels/'],
      ['spaces in the handle', 'audit 0905'],
      ['too long', 'a'.repeat(31)],
    ])('refuses %s with a message the owner can act on', (_label, input) => {
      const resolution = resolveInstagramInput(input);

      expect(resolution.status).toBe('invalid');
      expect(resolution.status === 'invalid' && resolution.error.length).toBeGreaterThan(0);
    });
  });

  describe('toInstagramHandle', () => {
    it('pre-fills an editor with the handle, never the stored URL', () => {
      expect(toInstagramHandle('https://www.instagram.com/audit0905lacquer/')).toBe('audit0905lacquer');
      expect(toInstagramHandle('@audit0905lacquer')).toBe('audit0905lacquer');
    });

    it('returns an empty string when nothing is stored', () => {
      expect(toInstagramHandle(null)).toBe('');
      expect(toInstagramHandle('')).toBe('');
    });

    it('keeps an unparseable stored value visible so the owner can fix it', () => {
      expect(toInstagramHandle('https://example.com/someone')).toBe('https://example.com/someone');
    });
  });

  describe('formatInstagramHandle', () => {
    it('shows what customers see', () => {
      expect(formatInstagramHandle('https://www.instagram.com/audit0905lacquer/')).toBe('@audit0905lacquer');
      expect(formatInstagramHandle('audit0905lacquer')).toBe('@audit0905lacquer');
    });

    it('shows nothing for an empty or invalid value', () => {
      expect(formatInstagramHandle(null)).toBeNull();
      expect(formatInstagramHandle('https://example.com/x')).toBeNull();
    });
  });

  it('round-trips: stored URL → handle → the same stored URL', () => {
    const stored = 'https://www.instagram.com/audit0905lacquer/';
    const handle = toInstagramHandle(stored);

    expect(buildInstagramProfileUrl(handle)).toBe(stored);
  });
});
