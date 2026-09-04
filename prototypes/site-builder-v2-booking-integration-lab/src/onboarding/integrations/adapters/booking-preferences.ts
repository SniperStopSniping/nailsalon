import { createLabBookingPreferencesPort } from '../lab/booking-preferences-port';

/**
 * Replace this binding with the salon Booking-settings adapter during
 * Production integration. The current implementation is intentionally local.
 */
export const bookingPreferencesPort = createLabBookingPreferencesPort();
