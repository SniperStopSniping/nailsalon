'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Clerk keeps its initial session-task routing for the lifetime of the browser
 * document. A sibling owner provider can therefore leave onboarding with its
 * dashboard task route even after the provider options change. Reset that
 * document before mounting onboarding's provider; the draft and session cookies
 * survive, and the existing claim endpoint still verifies ownership.
 */
export function FreshOnboardingAuthBoundary({ children }: { children: ReactNode }) {
  const decidedRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (decidedRef.current) {
      return;
    }
    // StrictMode replays effects. Never classify our own provider as inherited
    // or request a second reload during that replay.
    decidedRef.current = true;
    const inheritedClerk = (typeof window.Clerk !== 'undefined')
      || '__clerk_publishable_key' in window
      || document.querySelector('script[data-clerk-js-script]') !== null;
    if (inheritedClerk) {
      // A same-URL replace can retain the document when a hash is present.
      // reload preserves the complete URL and always resets the SDK instance.
      window.location.reload();
      return;
    }
    setReady(true);
  }, []);

  return ready
    ? children
    : <div className="flex min-h-screen items-center justify-center px-6 text-center" role="status">Opening your business setup…</div>;
}
