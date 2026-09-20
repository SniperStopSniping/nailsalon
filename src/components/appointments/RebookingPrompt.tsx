'use client';

import { useEffect, useRef, useState } from 'react';

import type { NextVisitOfferSettings } from '@/libs/nextVisitOffer';

type RebookingData = {
  promptEnabled: boolean;
  promptKey: string;
  bookingUrl: string;
  offer: { deadlineDate: string; currency: string; settings: NextVisitOfferSettings } | null;
};

// No capability, contact details or appointment data are stored in the browser.
// Storage-disabled browsers retain suppression for this page session only.
const suppressedThisSession = new Set<string>();
const storageKey = (key: string) => `luster:rebooking-prompt:${key}`;

function isSuppressed(key: string) {
  try {
    return suppressedThisSession.has(key) || window.localStorage.getItem(storageKey(key)) === '1';
  } catch {
    return suppressedThisSession.has(key);
  }
}

function suppress(key: string) {
  suppressedThisSession.add(key);
  try {
    window.localStorage.setItem(storageKey(key), '1');
  } catch {
    // Rebooking must remain usable when browser persistence is unavailable.
  }
}

/** Post-visit encouragement only. All offer and booking decisions stay server-side. */
export function RebookingPrompt({ token }: { token: string }) {
  const [data, setData] = useState<RebookingData | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const opening = useRef(false);
  const currentKey = useRef<string | null>(null);
  const bookButton = useRef<HTMLButtonElement | null>(null);
  const endpoint = `/api/public/appointments/manage/${encodeURIComponent(token)}/rebook`;

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    opening.current = false;
    currentKey.current = null;
    setData(null);
    setBusy(false);
    setError(null);
    setDismissed(true);
    void fetch(endpoint, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then((body) => {
        if (controller.signal.aborted || !body?.data?.promptKey) {
          return;
        }
        setData(body.data);
        currentKey.current = body.data.promptKey;
        setDismissed(isSuppressed(body.data.promptKey));
      }).catch(() => {});
    const onStorage = () => {
      if (currentKey.current && isSuppressed(currentKey.current)) {
        setDismissed(true);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      controller.abort();
      window.removeEventListener('storage', onStorage);
    };
  }, [endpoint]);

  if (!data || !data.promptEnabled) {
    return null;
  }
  const showPrompt = data.promptEnabled && !dismissed;
  const offer = data.offer;
  const savings = offer && (offer.settings.discountType === 'percent'
    ? `${offer.settings.value}%`
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: offer.currency }).format(offer.settings.value / 100));

  async function rebook() {
    if (opening.current || !data) {
      return;
    }
    const controller = active.current;
    if (!controller || controller.signal.aborted) {
      return;
    }
    opening.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: 'POST', signal: controller.signal });
      const body = await response.json();
      if (controller.signal.aborted) {
        return;
      }
      if (!response.ok || typeof body?.data?.bookingUrl !== 'string') {
        throw new Error('Unable to open rebooking. Please try again.');
      }
      suppress(data.promptKey);
      setDismissed(true);
      window.location.assign(body.data.bookingUrl);
    } catch {
      if (!controller.signal.aborted) {
        setError('Unable to open rebooking. Please try again.');
      }
    } finally {
      if (!controller.signal.aborted) {
        opening.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <section aria-label="Book your next appointment" className="mt-5 min-w-0 border-t border-stone-200 pt-5">
      {showPrompt && (
        <>
          <h2 className="break-words font-semibold text-stone-900">Ready to book your next visit?</h2>
          <p className="mt-2 break-words text-sm text-stone-600">
            {offer
              ? `Book your next eligible visit by ${offer.deadlineDate} and save ${offer.settings.discountType === 'fixed' ? 'up to ' : ''}${savings}.`
              : 'Book something similar or choose a different service.'}
          </p>
          <p className="mt-2 break-words text-sm text-stone-600">Choose your services again so prices, extras and availability are up to date.</p>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          ref={bookButton}
          type="button"
          disabled={busy}
          onClick={() => {
            void rebook();
          }}
          className="min-h-11 min-w-0 flex-1 whitespace-normal rounded-xl bg-stone-900 px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Opening booking…' : 'Book next appointment'}
        </button>
        {showPrompt && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              suppress(data.promptKey);
              setDismissed(true);
              bookButton.current?.focus();
            }}
            className="min-h-11 min-w-0 whitespace-normal rounded-xl border border-stone-300 px-4 py-3 text-stone-700 disabled:opacity-60"
          >
            Not now
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
    </section>
  );
}
