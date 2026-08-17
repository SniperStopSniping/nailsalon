import { describe, expect, it } from 'vitest';

import { normalizeNanpNumber, resolveSmsDestination } from './smsDestination';

describe('normalizeNanpNumber', () => {
  it('accepts NANP shapes with and without the +1 prefix', () => {
    expect(normalizeNanpNumber('+14165551234')).toEqual({ e164: '+14165551234', areaCode: '416' });
    expect(normalizeNanpNumber('14165551234')).toEqual({ e164: '+14165551234', areaCode: '416' });
    expect(normalizeNanpNumber('(416) 555-1234')).toEqual({ e164: '+14165551234', areaCode: '416' });
  });

  it('rejects non-NANP numbers instead of degrading them to digits', () => {
    expect(normalizeNanpNumber('+442071234567')).toBeNull();
    expect(normalizeNanpNumber('0416555123')).toBeNull();
    expect(normalizeNanpNumber('416555123')).toBeNull();
    expect(normalizeNanpNumber('')).toBeNull();
  });

  it('rejects invalid NPAs (leading 0/1 and N11 service codes)', () => {
    expect(normalizeNanpNumber('+11165551234')).toBeNull();
    expect(normalizeNanpNumber('+14115551234')).toBeNull();
    expect(normalizeNanpNumber('+19115551234')).toBeNull();
  });
});

describe('resolveSmsDestination — Canada-only pilot', () => {
  it('rejects a Canadian-looking +1 number with NO stored country (+1 is not proof of Canada)', () => {
    const decision = resolveSmsDestination({ rawPhone: '+14165551234', storedCountry: null });

    expect(decision).toEqual({ supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'NO_STORED_COUNTRY' });
  });

  it('supports stored CA + Canadian geographic area code', () => {
    const decision = resolveSmsDestination({ rawPhone: '+14165551234', storedCountry: 'CA' });

    expect(decision).toEqual({ supported: true, country: 'CA', e164: '+14165551234', areaCode: '416' });
  });

  it('rejects stored CA with a US area code as a conflict (never guesses)', () => {
    const decision = resolveSmsDestination({ rawPhone: '+12125551234', storedCountry: 'CA' });

    expect(decision).toEqual({ supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'AREA_CODE_CONFLICT' });
  });

  it('rejects stored US outright until US launch is separately approved', () => {
    const decision = resolveSmsDestination({ rawPhone: '+12125551234', storedCountry: 'US' });

    expect(decision).toEqual({ supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'UNSUPPORTED_COUNTRY' });
  });

  it('rejects non-NANP international numbers as invalid, not as digit soup', () => {
    const decision = resolveSmsDestination({ rawPhone: '+442071234567', storedCountry: 'CA' });

    expect(decision).toEqual({ supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'INVALID_NUMBER' });
  });

  it('treats every toll-free and service code as country-ambiguous regardless of stored country', () => {
    for (const npa of ['800', '833', '844', '855', '866', '877', '888', '900']) {
      const decision = resolveSmsDestination({ rawPhone: `+1${npa}5551234`, storedCountry: 'CA' });

      expect(decision).toEqual({ supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'NON_GEOGRAPHIC_AMBIGUOUS' });
    }
  });

  it('normalizes stored-country casing and whitespace but not meaning', () => {
    expect(resolveSmsDestination({ rawPhone: '+14165551234', storedCountry: ' ca ' }).supported).toBe(true);
    expect(resolveSmsDestination({ rawPhone: '+14165551234', storedCountry: '' }).supported).toBe(false);
  });

  it('honors an injected normalizer (the Gate B libphonenumber seam)', () => {
    const decision = resolveSmsDestination(
      { rawPhone: 'anything', storedCountry: 'CA' },
      { normalize: () => ({ e164: '+16045551234', areaCode: '604' }) },
    );

    expect(decision.supported).toBe(true);
  });
});
