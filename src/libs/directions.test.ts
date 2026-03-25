import { describe, expect, it } from 'vitest';

import { buildDirectionsDestination, buildGoogleMapsDirectionsUrl } from './directions';

describe('directions helpers', () => {
  it('builds a Google Maps directions URL from location address fields', () => {
    const url = buildGoogleMapsDirectionsUrl({
      name: 'Queen West',
      address: '123 Queen St W',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5H 2M9',
    });

    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=123%20Queen%20St%20W%2C%20Toronto%2C%20ON%2C%20M5H%202M9');
  });

  it('returns null when there is no usable address', () => {
    expect(buildDirectionsDestination({
      name: 'Queen West',
      address: null,
      city: '   ',
      state: null,
      zipCode: '',
    })).toBeNull();
  });
});
