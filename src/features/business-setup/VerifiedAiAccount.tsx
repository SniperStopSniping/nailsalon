'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { describeClerkError } from '@/features/onboarding-v1-integration/account-gate/clerk-errors';

import { ClerkSetupSession } from './ClerkSetupSession';
import { OpenAiBuilder } from './OpenAiBuilder';

/** Same Clerk email-code flow as onboarding; the server still verifies identity. */
export function VerifiedAiAccount({ locale }: { locale: string }) {
  const { isLoaded, user } = useUser();
  const clerk = useClerk();
  const email = user?.primaryEmailAddress;
  const verified = email?.verification.status === 'verified';
  const identity = user && email ? `${user.id}:${email.id}` : '';
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const prepared = useRef('');
  const mounted = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'sending' | 'verifying' | null>(null);
  const busy = phase !== null;
  const [error, setError] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !email || verified || prepared.current === identity) {
      return;
    }
    prepared.current = identity;
    setCode('');
    inputRef.current?.focus();
    setPhase('sending');
    setError('');
    void email.prepareVerification({ strategy: 'email_code' }).then(() => {
      if (mounted.current && activeIdentity.current === identity) {
        setResendAt(Date.now() + 30_000);
        setNow(Date.now());
      }
    }).catch((cause: unknown) => {
      if (mounted.current && activeIdentity.current === identity) {
        setError(describeClerkError(cause, 'We couldn’t send a verification code. Try sending a new code.'));
      }
    }).finally(() => {
      if (mounted.current && activeIdentity.current === identity) {
        setPhase(null);
      }
    });
  }, [email, identity, isLoaded, verified]);

  useEffect(() => {
    if (resendAt <= Date.now()) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= resendAt) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user || !email || busy || !/^\d{6}$/u.test(code)) {
      return;
    }
    setPhase('verifying');
    setError('');
    try {
      const result = await email.attemptVerification({ code });
      if (activeIdentity.current !== identity || !mounted.current) {
        return;
      }
      if (result.verification.status !== 'verified') {
        setError('That code didn’t finish verification. Send a new code and try again.');
        return;
      }
      await user.reload();
    } catch (cause) {
      if (activeIdentity.current === identity && mounted.current) {
        setError(describeClerkError(cause, 'That code doesn’t match. Check the newest email and try again.'));
      }
    } finally {
      if (activeIdentity.current === identity && mounted.current) {
        setPhase(null);
      }
    }
  }

  async function resend() {
    if (!email || busy || Date.now() < resendAt) {
      return;
    }
    setPhase('sending');
    setError('');
    try {
      await email.prepareVerification({ strategy: 'email_code' });
      if (activeIdentity.current === identity && mounted.current) {
        setResendAt(Date.now() + 30_000);
        setNow(Date.now());
      }
    } catch (cause) {
      if (activeIdentity.current === identity && mounted.current) {
        setError(describeClerkError(cause, 'We couldn’t send a new code. Please try again.'));
      }
    } finally {
      if (activeIdentity.current === identity && mounted.current) {
        setPhase(null);
      }
    }
  }

  if (!isLoaded) {
    return <section className="ai-entry-account"><p role="status">Opening your account…</p></section>;
  }
  if (!user) {
    return (
      <section className="ai-entry-account">
        <h2>Sign in to continue.</h2>
        <a href={`/${locale}/ai-website?account=sign-in#account`}>Sign in to Luster</a>
      </section>
    );
  }
  if (!email) {
    return (
      <section className="ai-entry-account">
        <h2>Add an email to continue.</h2>
        <p>Use a verified email to save your website and come back later.</p>
        <button type="button" className="ai-entry-primary" onClick={() => clerk.openUserProfile()}>Manage my account</button>
      </section>
    );
  }
  if (verified) {
    return <ClerkSetupSession locale={locale} userId={user.id}><OpenAiBuilder locale={locale} autoOpen /></ClerkSetupSession>;
  }
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  return (
    <section className="ai-entry-account" aria-busy={busy} aria-labelledby="ai-verify-title">
      <h2 id="ai-verify-title">One quick email check.</h2>
      <p>
        Verify
        {' '}
        {email.emailAddress}
        {' '}
        with a six-digit code to save your website.
      </p>
      <form className="ai-entry-code-form" onSubmit={event => void submit(event)}>
        <label htmlFor="ai-email-code">Verification code</label>
        <input ref={inputRef} id="ai-email-code" name="verificationCode" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} maxLength={6} />
        <button type="submit" className="ai-entry-primary" disabled={busy || code.length !== 6}>{busy ? 'Please wait…' : 'Verify email'}</button>
        <button type="button" className="ai-entry-secondary" disabled={busy || wait > 0} onClick={() => void resend()}>{wait ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
      </form>
      {busy && <p role="status">{phase === 'sending' ? 'Sending your code…' : 'Checking your code…'}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
