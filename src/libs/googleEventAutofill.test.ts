import { describe, expect, it } from 'vitest';

import { extractGoogleEventContact, parseGoogleEventTitle } from './googleEventAutofill';

describe('Google event autofill', () => {
  it('parses the booking title shown by Google Calendar', () => {
    expect(parseGoogleEventTitle('BIAB / Builder Gel Overlay — From $50 between Isla Nail Studio and Cynthia Okundigie')).toEqual({
      clientName: 'Cynthia Okundigie',
      serviceName: 'BIAB / Builder Gel Overlay',
    });
  });

  it('extracts a ten-digit phone from a Google SMS guest', () => {
    expect(extractGoogleEventContact([
      { email: 'milianbeltrandaniela@gmail.com', organizer: true },
      { email: '14373132358@sms.cal.com' },
    ], 'BIAB / Builder Gel Overlay — From $50 between Isla Nail Studio and Cynthia Okundigie')).toEqual({
      fullName: 'Cynthia Okundigie',
      phone: '4373132358',
      email: null,
    });
  });

  it('does not guess when multiple guest contacts are present', () => {
    expect(extractGoogleEventContact([
      { email: '14165550101@sms.cal.com' },
      { email: '14165550102@sms.cal.com' },
      { email: 'one@example.com' },
      { email: 'two@example.com' },
    ], null)).toBeNull();
  });
});
