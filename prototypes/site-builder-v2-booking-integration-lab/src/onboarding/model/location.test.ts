import { describe, expect, it } from 'vitest';

import { createDefaultBusinessProfile } from './defaults';
import { getPublicLocationPreview } from './location';

describe('public location privacy', () => {
  it('uses an exact address and Directions only when the address is public', () => {
    const location = createDefaultBusinessProfile().location;
    location.cityOrArea = 'Scarborough, Ontario';
    location.exactAddress = '123 Example Avenue';
    location.addressVisibility = 'public';

    expect(getPublicLocationPreview(location)).toEqual({
      detail: 'Scarborough, Ontario',
      directionsTarget: '123 Example Avenue',
      primary: '123 Example Avenue',
    });
  });

  it('uses after-booking copy and never exposes Directions', () => {
    const location = createDefaultBusinessProfile().location;
    location.cityOrArea = 'Scarborough, Ontario';
    location.exactAddress = '123 Example Avenue';
    location.addressVisibility = 'after_booking';
    location.allowGeneralAreaDirections = true;

    expect(getPublicLocationPreview(location)).toEqual({
      detail: 'Exact address shared after booking.',
      directionsTarget: null,
      primary: 'Scarborough, Ontario',
    });
  });

  it('requires explicit permission for general-area Directions and suppresses hidden Directions', () => {
    const location = createDefaultBusinessProfile().location;
    location.cityOrArea = 'Scarborough, Ontario';
    location.addressVisibility = 'public';
    expect(getPublicLocationPreview(location).directionsTarget).toBeNull();

    location.allowGeneralAreaDirections = true;
    expect(getPublicLocationPreview(location).directionsTarget).toBe('Scarborough, Ontario');

    location.addressVisibility = 'hidden';
    expect(getPublicLocationPreview(location)).toMatchObject({
      detail: null,
      directionsTarget: null,
      primary: 'Scarborough, Ontario',
    });
  });
});
