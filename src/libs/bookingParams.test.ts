import { describe, expect, it } from 'vitest';

import {
  appendSalonSlug,
  buildBookingUrl,
  buildChangeAppointmentUrl,
} from './bookingParams';

describe('bookingParams helpers', () => {
  it('preserves tenant and location context in booking step URLs without leaking clientPhone', () => {
    const url = buildBookingUrl('/en/book/confirm', {
      salonSlug: 'salon-a',
      serviceIds: ['srv_1', 'srv_2'],
      techId: 'tech_1',
      locationId: 'loc_1',
      originalAppointmentId: 'appt_1',
      date: '2026-03-20',
      time: '10:00',
    });

    expect(url).toBe('/en/book/confirm?salonSlug=salon-a&serviceIds=srv_1%2Csrv_2&locationId=loc_1&techId=tech_1&originalAppointmentId=appt_1&date=2026-03-20&time=10%3A00');
    expect(url).not.toContain('clientPhone');
  });

  it('builds reschedule URLs from the actual appointment payload without requiring clientPhone', () => {
    const url = buildChangeAppointmentUrl({
      salonSlug: 'salon-a',
      serviceIds: ['srv_1'],
      techId: 'tech_1',
      locationId: 'loc_1',
      originalAppointmentId: 'appt_1',
      startTime: '2026-03-20T15:30:00.000Z',
    });

    expect(url).toContain('salonSlug=salon-a');
    expect(url).toContain('locationId=loc_1');
    expect(url).toContain('originalAppointmentId=appt_1');
    expect(url).not.toContain('clientPhone');
  });

  it('builds slug-based booking step URLs when a route slug is active', () => {
    const url = buildBookingUrl('/en/book/confirm', {
      salonSlug: 'salon-a',
      serviceIds: ['srv_1', 'srv_2'],
      locationId: 'loc_1',
      techId: 'tech_1',
    }, {
      routeSalonSlug: 'salon-a',
      locale: 'en',
    });

    expect(url).toBe('/en/salon-a/book/confirm?serviceIds=srv_1%2Csrv_2&locationId=loc_1&techId=tech_1');
    expect(url).not.toContain('salonSlug=');
  });

  it('builds slug-based reschedule URLs when a route slug is active', () => {
    const url = buildChangeAppointmentUrl({
      salonSlug: 'salon-a',
      serviceIds: ['srv_1'],
      techId: 'tech_1',
      locationId: 'loc_1',
      originalAppointmentId: 'appt_1',
      startTime: '2026-03-20T15:30:00.000Z',
      basePath: '/en/change-appointment',
      tenantRoute: {
        routeSalonSlug: 'salon-a',
        locale: 'en',
      },
    });

    expect(url).toContain('/en/salon-a/change-appointment?');
    expect(url).toContain('serviceIds=srv_1');
    expect(url).toContain('locationId=loc_1');
    expect(url).toContain('techId=tech_1');
    expect(url).toContain('originalAppointmentId=appt_1');
    expect(url).toContain('date=2026-03-20');
    expect(url).not.toContain('salonSlug=');
  });

  it('adds salonSlug to existing customer navigation paths safely', () => {
    expect(appendSalonSlug('/profile', 'salon-a')).toBe('/profile?salonSlug=salon-a');
    expect(appendSalonSlug('/book?locationId=loc_1', 'salon-a')).toBe('/book?locationId=loc_1&salonSlug=salon-a');
  });

  it('preserves locale on legacy customer navigation paths when no route slug is active', () => {
    expect(appendSalonSlug('/profile', 'salon-a', {
      locale: 'fr',
    })).toBe('/fr/salon-a/profile');
    expect(buildBookingUrl('/book/service', {
      salonSlug: 'salon-a',
      locationId: 'loc_1',
    }, {
      locale: 'fr',
    })).toBe('/fr/salon-a/book/service?locationId=loc_1');
  });

  it('converts customer navigation paths to slug routes when a route slug is active', () => {
    expect(appendSalonSlug('/profile', 'salon-a', {
      routeSalonSlug: 'salon-a',
      locale: 'en',
    })).toBe('/en/salon-a/profile');
    expect(appendSalonSlug('/book?locationId=loc_1', 'salon-a', {
      routeSalonSlug: 'salon-a',
      locale: 'en',
    })).toBe('/en/salon-a/book?locationId=loc_1');
  });
});
