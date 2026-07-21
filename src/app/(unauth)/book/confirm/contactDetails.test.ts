import { describe, expect, it } from 'vitest';

import { getContactDetailsBlocker, maskPhone } from './BookConfirmClient';

const COMPLETE = { name: 'Ava Chen', email: 'ava@example.com', phone: '(416) 555-0101' };

describe('getContactDetailsBlocker', () => {
  it('returns null when every required detail is present', () => {
    expect(getContactDetailsBlocker(COMPLETE)).toBeNull();
  });

  it('names the missing name first', () => {
    expect(getContactDetailsBlocker({ ...COMPLETE, name: '   ' }))
      .toBe('Add your name to continue.');
  });

  it('names an empty or malformed email', () => {
    expect(getContactDetailsBlocker({ ...COMPLETE, email: '' }))
      .toBe('Enter a valid email address to continue.');
    expect(getContactDetailsBlocker({ ...COMPLETE, email: 'ava@' }))
      .toBe('Enter a valid email address to continue.');
  });

  it('names a short phone number', () => {
    expect(getContactDetailsBlocker({ ...COMPLETE, phone: '416555' }))
      .toBe('Enter a 10-digit mobile number to continue.');
  });

  it('accepts a phone with formatting characters', () => {
    expect(getContactDetailsBlocker({ ...COMPLETE, phone: '416-555-0101' })).toBeNull();
  });

  it('reports one requirement at a time, in field order', () => {
    // Everything missing: the customer is told about the name first, not all
    // three at once.
    expect(getContactDetailsBlocker({ name: '', email: '', phone: '' }))
      .toBe('Add your name to continue.');
  });
});

describe('maskPhone', () => {
  it('shows only the last four digits', () => {
    expect(maskPhone('4165550101')).toBe('(•••) •••-0101');
  });

  it('ignores formatting and a country code', () => {
    expect(maskPhone('+1 (416) 555-0101')).toBe('(•••) •••-0101');
  });

  it('returns nothing for a value too short to mask meaningfully', () => {
    expect(maskPhone('12')).toBe('');
    expect(maskPhone('')).toBe('');
  });

  it('never returns the full number', () => {
    const masked = maskPhone('4165550101');

    expect(masked).not.toContain('416555');
  });
});
