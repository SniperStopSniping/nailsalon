import { describe, expect, it } from 'vitest';

import {
  addCalendarWeeks,
  buildConfirmationRebookingFallbackUrl,
  buildConfirmationRebookingUrl,
} from './confirmationRebooking';

describe('confirmation rebooking handoff helpers', () => {
  it.each([
    ['2026-01-28', 3, '2026-02-18'],
    // America/Toronto begins daylight saving time on March 8, but a local
    // calendar recommendation still remains the same weekday three weeks on.
    ['2026-02-22', 3, '2026-03-15'],
    // And it remains stable across the autumn transition.
    ['2026-10-18', 3, '2026-11-08'],
  ])('adds calendar weeks without changing the local day (%s)', (source, weeks, expected) => {
    expect(addCalendarWeeks(source, weeks)).toBe(expected);
  });

  it('builds a tenant booking URL without campaign, payment, or management capabilities', () => {
    const url = buildConfirmationRebookingUrl({
      salonSlug: 'isla',
      locale: 'en',
      bookingBasket: { version: 2, items: [{ serviceId: 'service_1', selectedAddOns: [{ addOnId: 'addon_1', quantity: 2 }] }] },
      locationId: 'location_1',
      technicianId: 'technician_1',
      suggestedDate: '2026-10-14',
    });

    expect(url).toContain('/en/isla/book/time?');
    expect(url).toContain('bookingBasket=');
    expect(url).toContain('locationId=location_1');
    expect(url).toContain('techId=technician_1');
    expect(url).toContain('date=2026-10-14');
    expect(url).not.toContain('campaign');
    expect(url).not.toContain('manageToken');
  });

  it('marks a catalogue fallback without carrying a capability or stale pricing', () => {
    const url = buildConfirmationRebookingFallbackUrl({
      salonSlug: 'isla',
      locale: 'en',
      locationId: 'location_1',
      rebookingFallback: 'catalogue_changed',
      bookingBasket: { version: 2, items: [{ serviceId: 'service_1', selectedAddOns: [] }] },
    });

    expect(url).toContain('/en/isla/book/service?');
    expect(url).toContain('rebooking=catalogue_changed');
    expect(url).toContain('bookingBasket=');
    expect(url).not.toContain('campaign');
    expect(url).not.toContain('manageToken');
    expect(url).not.toContain('discount');
  });
});
