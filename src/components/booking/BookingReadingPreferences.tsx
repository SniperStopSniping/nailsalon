'use client';

import { useParams } from 'next/navigation';
import { type ReactNode, useEffect, useId, useState } from 'react';

import { bookingReadingCopy } from '@/locales/bookingReading';

const STORAGE_KEY = 'luster:booking-reading:v1';

/** A visitor preference only: never writes salon appearance or booking data. */
export function BookingReadingPreferences({ children }: { children: ReactNode }) {
  const params = useParams();
  const copy = bookingReadingCopy(String(params?.locale ?? 'en'));
  const [easyReading, setEasyReading] = useState(false);
  const helpId = useId();

  useEffect(() => {
    try {
      setEasyReading(window.localStorage.getItem(STORAGE_KEY) === 'easy');
    } catch {
      // Restricted/private storage must never prevent booking.
    }
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setEasyReading(event.newValue === 'easy');
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return (
    <div data-booking-readability={easyReading ? 'easy' : 'standard'}>
      <div className="booking-reading-toolbar">
        <button
          type="button"
          aria-pressed={easyReading}
          aria-describedby={helpId}
          onClick={() => {
            const next = !easyReading;
            setEasyReading(next);
            try {
              window.localStorage.setItem(STORAGE_KEY, next ? 'easy' : 'standard');
            } catch {
              // The control still works for this page without persistence.
            }
          }}
        >
          {copy.easierToRead}
          <span className="booking-reading-switch" aria-hidden="true"><span /></span>
          <span className="sr-only">{easyReading ? copy.readingOn : copy.readingOff}</span>
        </button>
        <span id={helpId} className="sr-only">{copy.readingHelp}</span>
      </div>
      {children}
    </div>
  );
}
