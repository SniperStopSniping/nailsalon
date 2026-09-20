'use client';

import { useEffect, useState } from 'react';

import type { NextVisitOfferSettings } from '@/libs/nextVisitOffer';

/** Private completed-visit capability; no customer account and no provider send. */
export function NextVisitOfferRebook({ token }: { token: string }) {
  const [offer, setOffer] = useState<{ deadlineDate: string; currency: string; settings: NextVisitOfferSettings } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/public/appointments/manage/${encodeURIComponent(token)}/next-visit-offer`;
  useEffect(() => {
    const controller = new AbortController();
    setOffer(null);
    void fetch(endpoint, { signal: controller.signal }).then(response => response.ok ? response.json() : null)
      .then((body) => {
        if (!controller.signal.aborted) {
          setOffer(body?.data?.offer ?? null);
        }
      }).catch(() => {});
    return () => controller.abort();
  }, [endpoint]);
  if (!offer) {
    return null;
  }
  const savings = offer.settings.discountType === 'percent' ? `${offer.settings.value}%` : new Intl.NumberFormat('en-CA', { style: 'currency', currency: offer.currency }).format(offer.settings.value / 100);
  async function rebook() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: 'POST' });
      const body = await response.json();
      const bookingUrl = body?.data?.offer?.bookingUrl;
      if (!response.ok || typeof bookingUrl !== 'string') {
        throw new Error('This offer is no longer available. Refresh to see its current status.');
      }
      window.location.assign(bookingUrl);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to open your offer. Try again.');
      setBusy(false);
    }
  }
  return (
    <section aria-label="Next Visit Offer" className="min-w-0 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
      <h2 className="font-semibold">Your Next Visit Offer</h2>
      <p className="mt-2 break-words text-sm">
        {`Save ${savings} on eligible services when your next appointment takes place by ${offer.deadlineDate}.`}
      </p>
      {offer.settings.messageTemplate && <p className="mt-2 break-words text-sm">{offer.settings.messageTemplate}</p>}
      <p className="mt-2 text-xs">One offer per completed visit. No account needed. Cannot be combined with another promotional discount.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void rebook();
        }}
        className="mt-3 min-h-11 w-full rounded-xl bg-emerald-900 px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Opening your offer…' : 'Rebook with this offer'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
    </section>
  );
}
