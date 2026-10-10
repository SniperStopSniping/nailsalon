import { describe, expect, it } from 'vitest';

import { humanizeNavigationText } from './navigationText';

const links = [
  { key: 'booking_page_hub', label: 'Booking Page' },
  { key: 'page_gallery', label: 'Profile & Portfolio' },
];

describe('owner-facing destination wording', () => {
  it('removes redundant keys from the observed live reply', () => {
    expect(humanizeNavigationText('Start in Booking Page (booking_page_hub). Open Profile & Portfolio (page_gallery).', links))
      .toBe('Start in Booking Page. Open Profile & Portfolio.');
  });

  it('replaces bare, parenthesized and backticked keys with approved labels', () => {
    expect(humanizeNavigationText('Try page_gallery, (page_gallery) or `booking_page_hub`.', links))
      .toBe('Try Profile & Portfolio, Profile & Portfolio or Booking Page.');
  });

  it('preserves price qualifiers, line breaks, ordinary words, unknown keys and substrings', () => {
    const text = 'French Tips: $10+.\nSimple Nail Art: $10 per nail. Price to be confirmed. calendar page_gallery_extra other_key /page_gallery';

    expect(humanizeNavigationText(text, [...links, { key: 'calendar', label: 'Calendar' }])).toBe(text);
  });

  it('renders labels literally and is safe to run again for stored replies', () => {
    const data = [{ key: 'page_gallery', label: 'Photos $& <test>' }];
    const result = humanizeNavigationText('Open page_gallery.', data);

    expect(result).toBe('Open Photos $& <test>.');
    expect(humanizeNavigationText(result, data)).toBe(result);
  });
});
