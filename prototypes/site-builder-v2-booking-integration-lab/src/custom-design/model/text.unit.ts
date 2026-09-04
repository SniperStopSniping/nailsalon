import { describe, expect, it } from 'vitest';

import { hasUnsafeTextControls, parseBoundedMultilinePlainText, parseBoundedSingleLineText } from './text';

describe('bounded plain-text control characters', () => {
  it.each([...Array.from({ length: 32 }, (_, code) => code), 127])(
    'rejects ASCII control %i in a single line and permits only multiline whitespace',
    (code) => {
      const value = `before${String.fromCharCode(code)}after`;

      expect(hasUnsafeTextControls(value)).toBe(true);
      expect(parseBoundedSingleLineText(value, 180)).toBeNull();
      expect(hasUnsafeTextControls(value, true)).toBe(![9, 10, 13].includes(code));
      expect(parseBoundedMultilinePlainText(value, 180) !== null).toBe([9, 10, 13].includes(code));
    },
  );

  it('preserves ordinary Unicode and normalizes multiline line breaks', () => {
    expect(parseBoundedSingleLineText('  Daniela’s café ✨  ', 180)).toBe('Daniela’s café ✨');
    expect(parseBoundedMultilinePlainText('  First\r\nSecond\rThird  ', 180)).toBe('First\nSecond\nThird');
  });
});
