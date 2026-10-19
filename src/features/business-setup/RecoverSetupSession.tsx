'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ClerkSetupSession } from './ClerkSetupSession';

function RepeatServerOwnershipCheck() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    setWaiting(true);
    // A refresh only repeats the normal server guard. It never opens a
    // workspace, creates a business, or treats a browser user ID as authority.
    router.refresh();
    const timer = setTimeout(() => setWaiting(false), 15_000);
    return () => clearTimeout(timer);
  }, [attempt, router]);

  return (
    <section className="setup-auth-state" aria-label="Open your saved work">
      <span className="setup-auth-brand">✦ LUSTER</span>
      <section role={waiting ? 'status' : 'alert'} aria-busy={waiting}>
        <h1>{waiting ? 'Opening your saved work…' : 'Your saved work is safe.'}</h1>
        <p>{waiting ? 'Finishing your sign-in.' : 'We couldn’t finish opening your website. Please try again.'}</p>
        {!waiting && <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
      </section>
    </section>
  );
}

/** Generic 401 recovery: no salon data or editor is sent before server auth. */
export function RecoverSetupSession({ locale }: { locale: string }) {
  const { userId } = useAuth();
  return <ClerkSetupSession userId={userId ?? ''} locale={locale}><RepeatServerOwnershipCheck /></ClerkSetupSession>;
}
