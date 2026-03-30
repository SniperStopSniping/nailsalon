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
        currency: 'USD',
        timezone: 'America/New_York',
        introPriceDefaultLabel: 'Soft Opening Price',
        firstVisitDiscountEnabled: true,
      },
    })).toEqual({
      bufferMinutes: 15,
      slotIntervalMinutes: 10,
      currency: 'USD',
      timezone: 'America/New_York',
      introPriceDefaultLabel: 'Soft Opening Price',
      firstVisitDiscountEnabled: true,
    });
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
