import { expect, it } from 'vitest';

import { manualLinkHref, manualLinkTargetsBooking } from './manual-link';

it.each([
  ['https://example.com/design', 'https://example.com/design'],
  ['https://www.instagram.com/my_studio/', 'https://www.instagram.com/my_studio/'],
  ['tel:+1 (416) 555-0100', 'tel:+14165550100'],
  ['sms:4165550100', 'sms:4165550100'],
  ['mailto:Studio@Example.COM?subject=Hello%20there', 'mailto:Studio@example.com?subject=Hello%20there'],
  ['#luster-canva-booking', '#luster-canva-booking'],
])('normalizes the owner destination %s without fetching it', (input, expected) => {
  expect(manualLinkHref(input)).toBe(expected);
});

it.each([
  'javascript:alert(1)',
  'data:text/html,hello',
  'http://example.com',
  'https://user:password@example.com',
  'https://127.0.0.1',
  'https://0x7f000001',
  'https://example.com:8443/',
  'https://service.internal/',
  'https://example.com/admin/delete',
  '/admin',
  '//example.com',
  '#missing[selector]',
  'mailto:studio@example.com?bcc=someone@example.com',
  'mailto:studio@example.com?subject=Hello%0ABcc%3Aanyone',
  'mailto:studio@example.com?subject=a&subject=b',
  'tel:123',
  'sms:4165550100?body=send',
  'https://example.com/\nmalicious',
])('denies unsafe or unrelated capabilities in %s', (input) => {
  expect(manualLinkHref(input)).toBeNull();
});

it('distinguishes a real booking destination from an Instagram handle or informational link', () => {
  expect(manualLinkTargetsBooking('My Instagram', 'https://www.instagram.com/booking_studio/')).toBe(false);
  expect(manualLinkTargetsBooking('Read booking policies', 'https://example.com/policies')).toBe(false);
  expect(manualLinkTargetsBooking('Book now', 'https://example.com/portfolio')).toBe(true);
  expect(manualLinkTargetsBooking('My link', 'https://calendly.com/my-studio')).toBe(true);
  expect(manualLinkTargetsBooking('My link', 'https://example.com/booking/new')).toBe(true);
});
