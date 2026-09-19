'use client';

import { useEffect, useState } from 'react';

/** Owner-only wayfinding. A separate tab preserves unsaved appointment work. */
export function OwnerPhotoRulesLink({ salonSlug }: { salonSlug?: string | null }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    const match = window.location.pathname.match(/^(\/(?:en|fr))?\/admin(?:\/|$)/);
    if (!match || !salonSlug) {
      setHref(null);
      return;
    }
    const query = new URLSearchParams({ salon: salonSlug, section: 'photos' });
    setHref(`${match[1] ?? ''}/admin/policies?${query}`);
  }, [salonSlug]);
  return href
    ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700">
          Open Photo Rules
          <span className="sr-only"> (opens in a new tab; keeps this appointment open)</span>
        </a>
      )
    : null;
}
