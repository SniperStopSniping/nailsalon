import { describe, expect, it } from 'vitest';

import { hasUnfilledMessageFields, personalizeClientMessage, unsupportedMessageFields } from './clientMessagePersonalization';

describe('custom message fields', () => {
  it('uses the first name, canonical link and salon name without interpreting replacement characters', () => {
    expect(personalizeClientMessage('Hi {{ first_name }}, {{salon_name}}: {{booking_link}}', { fullName: '  $& Ana Smith ', salonName: 'Isla', bookingUrl: 'https://isla.test/book' })).toBe('Hi $&, Isla: https://isla.test/book');
    expect(personalizeClientMessage('Hi {{first_name}}', { fullName: '  ', salonName: 'Isla', bookingUrl: 'https://isla.test/book' })).toBe('Hi there');
  });

  it('rejects unknown, unfinished and nested fields and identifies a field left in a rendered message', () => {
    expect(unsupportedMessageFields('{{first_name}} {{booking_link}} {{salon_name}}')).toBe(false);

    for (const message of ['{{missing}}', '{{first_name}', '{{{first_name}}}', 'first_name}}']) {
      expect(unsupportedMessageFields(message)).toBe(true);
    }

    expect(hasUnfilledMessageFields('Hi Ava, https://isla.test/book')).toBe(false);
    expect(hasUnfilledMessageFields('Hi {{first_name}}, https://isla.test/book')).toBe(true);
  });
});
