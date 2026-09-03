/** Shared catalogue metadata; safe for the owner library and browser-only onboarding. */
export const SERVICE_CATEGORIES = [
  'manicure',
  'builder_gel',
  'extensions',
  'pedicure',
  'hands',
  'feet',
  'combo',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const BOOKING_CATEGORIES = ['manicure', 'pedicure', 'combo'] as const;
export type BookingCategory = (typeof BOOKING_CATEGORIES)[number];

export const ADD_ON_CATEGORIES = ['nail_art', 'repair', 'removal', 'pedicure_addon'] as const;
export type AddOnCategory = (typeof ADD_ON_CATEGORIES)[number];
