import type { ReactNode } from 'react';

export function BookingReadingPreferences({ children }: { children: ReactNode }) {
  return (
    <div data-booking-readability="standard">{children}</div>
  );
}
