import { describe, expect, it } from 'vitest';

import { getFeaturedServices } from './bookingMerchandising';

describe('bookingMerchandising', () => {
  it('sorts featured services by category priority, then sort order, then stable name/id fallback', () => {
    const featured = getFeaturedServices([
      { id: 'svc-z', name: 'Gel X Overlay', category: 'extensions', sortOrder: 4 },
      { id: 'svc-b', name: 'Builder Gel Infill', category: 'builder_gel', sortOrder: 2 },
      { id: 'svc-a2', name: 'BIAB + Classic Pedicure', category: 'combo', sortOrder: 1 },
      { id: 'svc-a1', name: 'BIAB + Classic Pedicure', category: 'combo', sortOrder: 1 },
      { id: 'svc-non', name: 'Colour Change', category: 'manicure', sortOrder: 0 },
      { id: 'svc-c', name: 'Extensions Removal', category: 'extensions', sortOrder: 4 },
    ]);

    expect(featured.map(service => service.id)).toEqual([
      'svc-a1',
      'svc-a2',
      'svc-c',
      'svc-z',
      'svc-b',
    ]);
  });
});
