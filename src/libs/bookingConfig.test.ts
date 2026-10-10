import { describe, expect, it } from 'vitest';

import { DEFAULT_BOOKING_CONFIG, resolveBookingConfigFromSettings, resolveIntroPriceLabel } from '@/libs/bookingConfig';

describe('bookingConfig', () => {
  it('applies defaults when booking settings are missing', () => {
    expect(resolveBookingConfigFromSettings(null)).toEqual(DEFAULT_BOOKING_CONFIG);
  });

  it('preserves valid configured booking settings', () => {
    expect(resolveBookingConfigFromSettings({
      booking: {
        bufferMinutes: 15,
        slotIntervalMinutes: 10,
        minimumNoticeMinutes: 480,
        currency: 'USD',
        timezone: 'America/New_York',
        introPriceDefaultLabel: 'Soft Opening Price',
        firstVisitDiscountEnabled: true,
      },
    })).toEqual({
      confirmationMode: 'instant',
      bufferMinutes: 15,
      slotIntervalMinutes: 10,
      minimumNoticeMinutes: 480,
      currency: 'USD',
      timezone: 'America/New_York',
      introPriceDefaultLabel: 'Soft Opening Price',
      firstVisitDiscountEnabled: true,
      clientChangeCutoffHours: 24,
      // Not set above, and therefore off: required-add-on enforcement is never
      // inherited from an unrelated booking-settings edit (PR 1 stage e).
      enforceRequiredAddOns: false,
    });
  });

  it('defaults to automatic confirmation and preserves an explicit review choice', () => {
    expect(resolveBookingConfigFromSettings(null).confirmationMode).toBe('instant');
    expect(resolveBookingConfigFromSettings({ booking: { confirmationMode: 'request_approval' } }).confirmationMode).toBe('request_approval');
    expect(resolveBookingConfigFromSettings({ booking: { confirmationMode: 'request_approval', minimumNoticeMinutes: -1 } }).confirmationMode).toBe('request_approval');
  });

  it('falls back to two hours when minimum notice is absent or malformed', () => {
    expect(resolveBookingConfigFromSettings({ booking: {} }).minimumNoticeMinutes).toBe(120);
    expect(resolveBookingConfigFromSettings({
      booking: { minimumNoticeMinutes: -1 },
    }).minimumNoticeMinutes).toBe(120);
  });

  it('retains legacy cutoff settings without discarding other saved booking rules', () => {
    expect(resolveBookingConfigFromSettings({ booking: { clientChangeCutoffHours: 168 } }).clientChangeCutoffHours).toBe(168);
  });

  it('hides intro labels after expiry and falls back to salon defaults otherwise', () => {
    const bookingConfig = resolveBookingConfigFromSettings({
      booking: {
        ...DEFAULT_BOOKING_CONFIG,
        introPriceDefaultLabel: 'Founding Client Price',
      },
    });

    expect(resolveIntroPriceLabel({
      isIntroPrice: true,
      introPriceLabel: null,
      introPriceExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      bookingConfig,
      now: new Date('2026-03-27T12:00:00.000Z'),
    })).toBe('Founding Client Price');

    expect(resolveIntroPriceLabel({
      isIntroPrice: true,
      introPriceLabel: 'Launch Price',
      introPriceExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
      bookingConfig,
      now: new Date('2026-03-27T12:00:00.000Z'),
    })).toBeNull();
  });
});
