import { Inter, Newsreader } from 'next/font/google';
import type { ReactNode } from 'react';

import { LusterWordmark } from '@/components/owner-entry/LusterEntryShell';

import styles from './customer-booking.module.css';

const bookingSans = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-owner-sans' });
const bookingDisplay = Newsreader({ subsets: ['latin'], display: 'swap', variable: '--font-owner-display' });

/** Luster's shared visual language, scoped to private booking utilities. */
export function CustomerBookingShell({ children, eyebrow }: { children: ReactNode; eyebrow: string }) {
  return (
    <main className={`owner-theme-scope ${bookingSans.variable} ${bookingDisplay.variable} ${styles.page}`}>
      <div className={styles.container}>
        <header className={styles.brand}>
          <LusterWordmark />
          <p>{eyebrow}</p>
        </header>
        {children}
      </div>
    </main>
  );
}
