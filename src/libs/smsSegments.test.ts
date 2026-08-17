import { describe, expect, it } from 'vitest';

import { calculateSmsSegments, formatSegmentPreview, isGsmCompatible } from './smsSegments';

const gsm = (length: number) => 'a'.repeat(length);
const bmp = (length: number) => 'あ'.repeat(length);

describe('calculateSmsSegments — GSM-7', () => {
  it('bills 160 GSM characters as one segment and 161 as two', () => {
    expect(calculateSmsSegments(gsm(160))).toMatchObject({ encoding: 'gsm7', billableUnits: 160, segments: 1, limitForSegments: 160 });
    expect(calculateSmsSegments(gsm(161))).toMatchObject({ segments: 2, limitForSegments: 306 });
  });

  it('packs concatenated GSM at 153 septets per segment (306 → 2, 307 → 3)', () => {
    expect(calculateSmsSegments(gsm(306)).segments).toBe(2);
    expect(calculateSmsSegments(gsm(307)).segments).toBe(3);
  });

  it('charges extension characters two septets (158+€ = 160 → 1; 159+€ = 161 → 2)', () => {
    expect(calculateSmsSegments(`${gsm(158)}€`)).toMatchObject({ encoding: 'gsm7', billableUnits: 160, segments: 1 });
    expect(calculateSmsSegments(`${gsm(159)}€`)).toMatchObject({ billableUnits: 161, segments: 2 });
  });

  it('never straddles an extension pair across the 153-septet concat boundary (the vector that kills naive ceil)', () => {
    // 152 plain + € + 152 plain = 306 naive septets; naive math says 2
    // segments, correct packing says 3 (the pair cannot split, so septet
    // 153 of segment one is wasted).
    const body = `${gsm(152)}€${gsm(152)}`;

    expect(calculateSmsSegments(body).billableUnits).toBe(306);
    expect(calculateSmsSegments(body).segments).toBe(3);
  });

  it('treats every documented extension character as GSM-compatible at double cost', () => {
    const extension = '^{}\\[~]|€\f';

    expect(isGsmCompatible(extension)).toBe(true);
    expect(calculateSmsSegments(extension)).toMatchObject({ encoding: 'gsm7', billableUnits: 20 });
  });

  it('counts CRLF as two septets', () => {
    expect(calculateSmsSegments('\r\n').billableUnits).toBe(2);
  });

  it('reports an empty body as one predicted segment (documented billing floor)', () => {
    expect(calculateSmsSegments('')).toMatchObject({ encoding: 'gsm7', billableUnits: 0, segments: 1 });
  });
});

describe('calculateSmsSegments — UCS-2', () => {
  it('bills 70 UCS-2 units as one segment, 71 as two, 134 as two', () => {
    expect(calculateSmsSegments(bmp(70))).toMatchObject({ encoding: 'ucs2', billableUnits: 70, segments: 1, limitForSegments: 70 });
    expect(calculateSmsSegments(bmp(71)).segments).toBe(2);
    expect(calculateSmsSegments(bmp(134)).segments).toBe(2);
  });

  it('never splits a surrogate pair at the 67-unit concat boundary (66 + emoji + 66 → 3 segments)', () => {
    const body = `${bmp(66)}😀${bmp(66)}`;

    expect(calculateSmsSegments(body).billableUnits).toBe(134);
    expect(calculateSmsSegments(body).segments).toBe(3);
  });

  it('forces UCS-2 for the whole message on a single non-GSM character', () => {
    const smartQuote = `${gsm(100)}’`;
    const result = calculateSmsSegments(smartQuote);

    expect(result.encoding).toBe('ucs2');
    expect(result.segments).toBe(2);
    expect(result.nonGsmCharacters).toEqual(['’']);
  });

  it('flags typographic punctuation, CJK and emoji as non-GSM offenders', () => {
    for (const offender of ['’', '–', '…', '漢', '😀']) {
      const result = calculateSmsSegments(`hello ${offender}`);

      expect(result.encoding).toBe('ucs2');
      expect(result.nonGsmCharacters).toContain(offender);
    }
  });

  it('counts malformed lone surrogates without throwing', () => {
    const lone = '\uD83D';

    expect(() => calculateSmsSegments(lone)).not.toThrow();
    expect(calculateSmsSegments(lone)).toMatchObject({ encoding: 'ucs2', billableUnits: 1, segments: 1 });
  });
});

describe('formatSegmentPreview', () => {
  it('renders the admin counter string', () => {
    expect(formatSegmentPreview(calculateSmsSegments(gsm(142)))).toBe('142/160 · 1 SMS credit');
    expect(formatSegmentPreview(calculateSmsSegments(gsm(161)))).toBe('161/306 · 2 SMS credits');
  });
});
