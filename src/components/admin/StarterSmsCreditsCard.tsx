'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

type ClaimStatus = 'granted' | 'already_claimed' | 'verification_required' | 'identity_setup_required';
type StarterCreditsStatus = 'verified' | 'verification_required' | 'unclaimed';
type Verification = { email: boolean; phone: boolean };
type StatusState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: StarterCreditsStatus; canClaim: boolean; verification?: Verification }
  | { kind: 'error' };

type StarterSmsCreditsCardProps = {
  salonId: string;
  /** A positive balance identifies a historical starter grant to reconcile. */
  hasKnownStarterCredits?: boolean;
  inline?: boolean;
  onClaimed: () => Promise<void> | void;
};

const STATUS_ENDPOINT = '/api/admin/salon/communications/starter-credits';
const VERIFIED_MESSAGE = 'Free-text allowance already claimed. Verification does not add another 100 credits.';

/** The server is the source of truth when the billing panel opens. */
export function StarterSmsCreditsCard({
  salonId,
  hasKnownStarterCredits = false,
  inline = false,
  onClaimed,
}: StarterSmsCreditsCardProps) {
  const clerk = useClerk();
  const { user } = useUser();
  const headingId = useId();
  const claimInFlight = useRef(false);
  const [verificationOpened, setVerificationOpened] = useState(false);
  const contactVersion = `${user?.primaryEmailAddress?.id}:${user?.primaryEmailAddress?.verification?.status}:${user?.primaryPhoneNumber?.id}:${user?.primaryPhoneNumber?.verification?.status}`;
  const sectionClassName = inline
    ? 'mt-4 space-y-3 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-blush)] p-4 text-[var(--owner-ink)]'
    : 'owner-card space-y-3 p-5 text-[var(--owner-ink)]';
  const currentSalonId = useRef(salonId);
  currentSalonId.current = salonId;
  const requestVersion = useRef(0);
  const [statusState, setStatusState] = useState<StatusState>({ kind: 'loading' });
  const [claiming, setClaiming] = useState(false);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const loadStatus = useCallback(async () => {
    if (claimInFlight.current) {
      return;
    }
    const version = ++requestVersion.current;
    setStatusState({ kind: 'loading' });
    setClaiming(false);
    setCompletedMessage(null);
    setMessage(null);
    setNeedsVerification(false);
    try {
      const query = new URLSearchParams({ salonId });
      const response = await fetch(`${STATUS_ENDPOINT}?${query.toString()}`, { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      const status = body?.data?.status;
      const canClaim = body?.data?.canClaim;
      if (!response.ok || (status !== 'verified' && status !== 'verification_required' && status !== 'unclaimed') || typeof canClaim !== 'boolean') {
        throw new Error('status fetch failed');
      }
      if (requestVersion.current === version) {
        const value = body?.data?.verification;
        const verification = typeof value?.email === 'boolean' && typeof value?.phone === 'boolean' ? value as Verification : undefined;
        setStatusState({ kind: 'ready', status, canClaim, verification });
      }
    } catch {
      if (requestVersion.current === version) {
        setStatusState({ kind: 'error' });
      }
    }
  }, [salonId]);

  useEffect(() => {
    claimInFlight.current = false;
    setVerificationOpened(false);
    void loadStatus();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadStatus]);

  // Clerk updates the contact resources after verification in its profile modal.
  // Re-read the server proof; the browser never decides credit eligibility.
  useEffect(() => {
    if (verificationOpened) {
      void loadStatus();
    }
  }, [contactVersion, verificationOpened, loadStatus]);

  useEffect(() => {
    if (!verificationOpened) {
      return;
    }
    const recheck = () => {
      if (document.visibilityState === 'visible') {
        void loadStatus();
      }
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [verificationOpened, loadStatus]);

  const openVerification = useCallback(() => {
    setVerificationOpened(true);
    clerk.openUserProfile();
  }, [clerk]);

  const claim = useCallback(async () => {
    if (claimInFlight.current || claiming || statusState.kind !== 'ready' || !statusState.canClaim) {
      return;
    }
    const version = ++requestVersion.current;
    claimInFlight.current = true;
    try {
      setClaiming(true);
      setMessage(null);
      setNeedsVerification(false);
      const response = await fetch(STATUS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId }),
      });
      const body = await response.json().catch(() => null);
      const status = body?.data?.status as ClaimStatus | undefined;
      if (requestVersion.current !== version || currentSalonId.current !== salonId) {
        return;
      }
      if (!response.ok) {
        throw new Error(typeof body?.error?.message === 'string'
          ? body.error.message
          : 'Free texts could not be claimed. Please try again.');
      }
      if (status === 'granted' || status === 'already_claimed') {
        await onClaimed();
        if (requestVersion.current !== version || currentSalonId.current !== salonId) {
          return;
        }
        setCompletedMessage(status === 'granted' && body?.data?.granted === true
          ? '100 free SMS credits have been added.'
          : VERIFIED_MESSAGE);
        setStatusState({ kind: 'ready', status: 'verified', canClaim: false });
        return;
      }
      if (status === 'verification_required') {
        setNeedsVerification(true);
        setMessage('Verify your primary email and phone number to claim your free texts.');
        return;
      }
      setMessage('Free texts are temporarily unavailable. Please try again later or contact support.');
    } catch (error) {
      if (requestVersion.current !== version || currentSalonId.current !== salonId) {
        return;
      }
      setMessage(error instanceof Error && error.message
        ? error.message
        : 'Free texts could not be claimed. Please try again.');
    } finally {
      if (requestVersion.current === version && currentSalonId.current === salonId) {
        claimInFlight.current = false;
        setClaiming(false);
      }
    }
  }, [claiming, onClaimed, salonId, statusState]);

  if (statusState.kind === 'loading') {
    return (
      <section aria-labelledby={headingId} className={sectionClassName}>
        <h3 id={headingId} className="text-base font-semibold">Free-text allowance</h3>
        <p role="status" aria-live="polite" className="text-sm leading-relaxed text-[var(--owner-muted)]">Checking free-text allowance…</p>
      </section>
    );
  }

  if (statusState.kind === 'error') {
    return (
      <section aria-labelledby={headingId} className={sectionClassName}>
        <h3 id={headingId} className="text-base font-semibold">Free-text allowance</h3>
        <p role="status" aria-live="polite" className="text-sm leading-relaxed text-[var(--owner-muted)]">We could not check your free-text allowance. Please try again.</p>
        <button type="button" onClick={() => void loadStatus()} className="owner-action w-full sm:w-auto">
          Retry status check
        </button>
      </section>
    );
  }

  if (statusState.status === 'verified') {
    if (inline && !completedMessage) {
      return null;
    }
    return <p role="status" aria-live="polite" className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-blush)] p-4 text-sm leading-relaxed text-[var(--owner-accent)]">{completedMessage ?? VERIFIED_MESSAGE}</p>;
  }

  if (!statusState.canClaim) {
    return (
      <section aria-labelledby={headingId} className={sectionClassName}>
        <h3 id={headingId} className="text-base font-semibold">Free-text allowance</h3>
        <p className="text-sm leading-relaxed text-[var(--owner-muted)]">Only the salon owner can verify the free-text allowance. Sign in with the owner account.</p>
      </section>
    );
  }

  const verification = statusState.verification;
  const requiresVerification = needsVerification || Boolean(verification && (!verification.email || !verification.phone));
  return (
    <section aria-labelledby={headingId} className={sectionClassName}>
      <h3 id={headingId} className="text-base font-semibold">
        {hasKnownStarterCredits || statusState.status === 'verification_required' ? 'Verify your free-text allowance' : '100 free SMS credits'}
      </h3>
      <p className="text-sm leading-relaxed text-[var(--owner-muted)]">
        {hasKnownStarterCredits || statusState.status === 'verification_required'
          ? 'Link your verified owner email and phone number to your existing lifetime allowance. Your SMS credit balance stays the same.'
          : 'One welcome allowance per verified owner. No payment needed.'}
      </p>
      {verification && (
        <ul aria-label="Free text verification" className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--owner-accent)]">
          <li>{verification.email ? '✓ Email verified' : '1. Verify email'}</li>
          <li>{verification.phone ? '✓ Phone verified' : '2. Verify phone'}</li>
        </ul>
      )}
      {requiresVerification && !inline && <p className="text-sm leading-relaxed text-[var(--owner-muted)]">Verify your primary email and phone in your account, then return here to finish.</p>}
      <button type="button" onClick={requiresVerification ? openVerification : () => void claim()} disabled={claiming} className="owner-action owner-action--primary w-full disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none">
        {claiming ? 'Verifying…' : requiresVerification ? 'Verify email and phone' : hasKnownStarterCredits || statusState.status === 'verification_required' ? 'Verify free-text allowance' : 'Claim 100 free texts'}
      </button>
      {verificationOpened && requiresVerification && (
        <button type="button" onClick={() => void loadStatus()} className="min-h-11 w-full text-sm font-semibold text-[var(--owner-accent)]">
          I’ve verified — check again
        </button>
      )}
      {message && <p role="status" aria-live="polite" className="text-sm leading-relaxed text-[var(--owner-muted)]">{message}</p>}
    </section>
  );
}
