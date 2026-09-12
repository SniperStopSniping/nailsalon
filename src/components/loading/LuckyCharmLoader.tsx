'use client';

import { Check, Heart, Sparkles } from 'lucide-react';

import { cn } from '@/utils/Helpers';

import styles from './LuckyCharmLoader.module.css';

type LuckyCharmLoaderProps = {
  className?: string;
};

export function LuckyCharmLoader({ className }: LuckyCharmLoaderProps) {
  return (
    <div className={cn(styles.loader, className)}>
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.story} aria-hidden="true">
        <div className={styles.orbit} />
        <div className={styles.charmAssembly}>
          <div className={styles.charmLoop} />
          <div className={styles.charm}>
            <div className={styles.charmDepth} />
            <div className={styles.charmFace}>
              <span className={styles.mark}>
                <span>Luster</span>
                <small>Gel</small>
              </span>
            </div>
          </div>
          <div className={styles.charmShadow} />
        </div>

        <div className={styles.bookingCard}>
          <div className={styles.cardTopline}>
            <span>New booking</span>
            <span className={styles.cardDot} />
          </div>
          <strong>Gel Manicure</strong>
          <span className={styles.cardTime}>2:30 PM</span>
          <div className={styles.bookedStamp}>
            <Check size={13} strokeWidth={3} />
            {' '}
            Booked
          </div>
        </div>

        <div className={styles.valueToken}>
          <span>+$65</span>
          <small>sample</small>
        </div>
        <div className={styles.heart}><Heart size={24} fill="currentColor" /></div>
        <div className={styles.sparkleOne}><Sparkles size={22} /></div>
        <div className={styles.sparkleTwo}>✦</div>
      </div>

      <div className={styles.loadingCopy}>
        <strong>Booked &amp; busy</strong>
        <span>Getting your studio ready…</span>
      </div>
    </div>
  );
}
