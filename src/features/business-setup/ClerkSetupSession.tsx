'use client';

import './clerk-setup-session.css';

import { useAuth } from '@clerk/nextjs';
import { type ReactNode, useEffect, useState } from 'react';

/** A verified SSR owner still needs Clerk's browser cookie before API calls. */
export function ClerkSetupSession({ userId: expectedUserId, locale, children }: { userId: string; locale: string; children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isLoaded) {
      setReadyFor(null);
      setError(false);
      const timer = setTimeout(() => setError(true), 20_000);
      return () => clearTimeout(timer);
    }
    if (!isSignedIn || userId !== expectedUserId) {
      setReadyFor(null);
      return;
    }
    let active = true;
    setError(false);
    const timer = setTimeout(() => {
      if (active) {
        active = false;
        setError(true);
      }
    }, 20_000);
    // Clerk refreshes its cookie during hydration. Do not manufacture a
    // cookie or pass client identity to the server; let the SDK complete it.
    void Promise.resolve().then(() => getToken({ skipCache: true })).then((token) => {
      if (active) {
        if (token) {
          setReadyFor(expectedUserId);
        } else {
          setError(true);
        }
      }
    }).catch(() => {
      if (active) {
        setError(true);
      }
    }).finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attempt, expectedUserId, getToken, isLoaded, isSignedIn, userId]);

  if (isLoaded && isSignedIn && userId === expectedUserId && readyFor === expectedUserId) {
    return children;
  }
  const changedAccount = isLoaded && isSignedIn && userId !== expectedUserId;
  const signedOut = isLoaded && !isSignedIn;
  return (
    <section className="setup-auth-state" aria-label="Open your saved work">
      <span className="setup-auth-brand">✦ LUSTER</span>
      <section role={error || changedAccount || signedOut ? 'alert' : 'status'} aria-busy={!error && !changedAccount && !signedOut}>
        <h1>{changedAccount ? 'Your sign-in changed.' : signedOut ? 'Sign in to continue.' : error ? 'Your saved work is safe.' : 'Opening your saved work…'}</h1>
        {changedAccount
          ? (
              <>
                <p>Reload to open the business you’re signed in to.</p>
                <button type="button" onClick={() => window.location.reload()}>Reload</button>
              </>
            )
          : signedOut
            ? (
                <>
                  <p>Sign in again to open your saved website.</p>
                  <a href={`/${locale}/owner-sign-in`}>Sign in to Luster</a>
                </>
              )
            : error
              ? (
                  <>
                    <p>We couldn’t finish signing you in. Please try again.</p>
                    <button type="button" onClick={() => isLoaded ? setAttempt(value => value + 1) : window.location.reload()}>Try again</button>
                  </>
                )
              : <p>Finishing your sign-in.</p>}
      </section>
    </section>
  );
}
