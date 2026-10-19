'use client';

import { useUser } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import { useState } from 'react';

export function OpenPreviewTrial({ locale }: { locale: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function open() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/business-setup/trial', { method: 'POST' });
      const result = await response.json();
      if (!response.ok || typeof result.data?.slug !== 'string') {
        throw new Error(result.error?.message ?? 'We could not open your test. Please try again.');
      }
      // A full navigation crosses the auth/admin layouts without depending on
      // server-action redirect prefetches through Preview access protection.
      window.location.assign(`/${locale}/admin/business-setup?salon=${encodeURIComponent(result.data.slug)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please try again.');
      setBusy(false);
    }
  }
  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void open()} className="rounded-full bg-stone-900 px-8 py-4 font-medium text-white disabled:opacity-50">{busy ? 'Opening your saved test…' : 'Open my AI website test'}</button>
    </div>
  );
}

/** Uses the same Clerk email-code verification as the existing owner onboarding. */
export function VerifiedTrialAccess({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useUser();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const email = user?.primaryEmailAddress;
  if (!isLoaded) {
    return <p role="status">Loading your account…</p>;
  }
  if (email?.verification.status === 'verified') {
    return children;
  }
  async function verify(send: boolean) {
    if (!email) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (send) {
        await email.prepareVerification({ strategy: 'email_code' });
        setSent(true);
      } else {
        const result = await email.attemptVerification({ code: code.trim() });
        if (result.verification.status !== 'verified') {
          throw new Error('Unverified');
        }
        await user?.reload();
      }
    } catch {
      setError(send ? 'We could not send the code. Please try again.' : 'That code could not be verified. Check it or request a new code.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Verify your email" className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border p-6">
      <h2 className="text-xl font-medium">Verify your email to save your website</h2>
      <p>{email ? `We’ll send a code to ${email.emailAddress}.` : 'Add an email to your account, then refresh this page.'}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy || !email} onClick={() => void verify(true)} className="rounded-full border px-5 py-3 disabled:opacity-50">{sent ? 'Send a new code' : 'Send verification code'}</button>
      {sent && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void verify(false);
          }}
        >
          <label htmlFor="trial-email-code">Email verification code</label>
          <input id="trial-email-code" value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="[0-9]{6}" className="rounded-lg border px-4 py-3" disabled={busy} />
          <button type="submit" disabled={busy || !/^\d{6}$/.test(code.trim())} className="rounded-full bg-stone-900 px-5 py-3 text-white disabled:opacity-50">Verify code</button>
        </form>
      )}
    </section>
  );
}
