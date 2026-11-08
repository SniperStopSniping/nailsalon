'use client';

import { Gift } from 'lucide-react';
import { useEffect, useState } from 'react';

import { FOUNDING_LIFETIME_CLAIM_DEADLINE, FOUNDING_LIFETIME_TERMS, isFoundingLifetimeOfferOpen } from '@/libs/billing/foundingLifetime';
import type { MarketingLocale } from '@/libs/marketingContent';

import styles from './home.module.css';
import { homeContent } from './homeContent';

/** Uses the same deadline as the claim endpoint; also expires in an already-open tab. */
export function HomeOffer({ locale, initiallyOpen }: { locale: MarketingLocale; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const remaining = Date.parse(FOUNDING_LIFETIME_CLAIM_DEADLINE) - Date.now();
      setOpen(isFoundingLifetimeOfferOpen());
      if (remaining > 0) {
        timer = setTimeout(refresh, Math.min(remaining, 2_147_483_647));
      }
    };
    refresh();
    return () => clearTimeout(timer);
  }, []);
  if (!open) {
    return null;
  }
  const copy = homeContent[locale];
  const deadline = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    timeZone: FOUNDING_LIFETIME_TERMS.deadlineTimeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.parse(FOUNDING_LIFETIME_CLAIM_DEADLINE) - 1));
  return (
    <aside className={styles.offer} aria-label={copy.offer}>
      <Gift aria-hidden="true" />
      <div>
        <strong>{copy.offer}</strong>
        <p>{`${copy.deadline} ${deadline}.`}</p>
        <small>{copy.extras}</small>
      </div>
    </aside>
  );
}
