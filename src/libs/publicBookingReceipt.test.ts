import { describe, expect, it } from 'vitest';

import { publicBookingReceiptPresentation } from './publicBookingReceipt';

const receipt = { data: {
  appointment: { startTime: '2030-01-02T15:00:00Z', totalPrice: 6500, totalDurationMinutes: 75, bookingTaxSnapshot: { invoiceTotalCents: 7345, currency: 'CAD' } },
  services: [{ service: { id: 'gel', name: 'Booked gel service' }, priceAtBooking: 6500, durationAtBooking: 75 }],
  addOns: [],
  technician: { id: 'tech', name: 'Assigned artist', avatarUrl: null },
} };

describe('recovered booking receipt presentation', () => {
  it('uses booked price, tax total, duration and assigned artist instead of current menu props', () => {
    expect(publicBookingReceiptPresentation(receipt, 'America/Toronto')).toMatchObject({
      totalPrice: 73.45,
      totalCents: 7345,
      currency: 'CAD',
      totalDuration: 75,
      dateStr: '2030-01-02',
      timeStr: '10:00',
      services: [{ id: 'gel', name: 'Booked gel service', price: 65, duration: 75 }],
      technician: { id: 'tech', name: 'Assigned artist' },
    });
  });

  it('does not invent missing historical tax or appointment facts', () => {
    expect(publicBookingReceiptPresentation({ data: { appointment: { id: 'old' } } }, 'America/Toronto')).toBeNull();
    expect(publicBookingReceiptPresentation({ data: { ...receipt.data, appointment: { ...receipt.data.appointment, bookingTaxSnapshot: null } } }, 'America/Toronto')).toBeNull();
  });
});
