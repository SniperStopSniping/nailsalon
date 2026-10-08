'use client';

import { useClerk } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';

type ClaimStatus = 'granted' | 'already_claimed' | 'verification_required' | 'identity_setup_required';
type StarterCreditsStatus = 'verified' | 'verification_required' | 'unclaimed';
type StatusState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: StarterCreditsStatus; canClaim: boolean }
  | { kind: 'error' };

type StarterSmsCreditsCardProps = {
  salonId: string;
  /** A positive balance identifies a historical starter grant to reconcile. */
  hasKnownStarterCredits: boolean;
  onClaimed: () => Promise<void> | void;
};

const STATUS_ENDPOINT = '/api/admin/salon/communications/starter-credits';
const VERIFIED_MESSAGE = 'Your free-text allowance has been verified. Your existing SMS credits are unchanged.';

/** The server is the source of truth when the billing panel opens. */
export function StarterSmsCreditsCard({
  salonId,
  hasKnownStarterCredits,
  onClaimed,
}: StarterSmsCreditsCardProps) {
  const clerk = useClerk();
  const currentSalonId = useRef(salonId);
  currentSalonId.current = salonId;
  const requestVersion = useRef(0);
  const [statusState, setStatusState] = useState<StatusState>({ kind: 'loading' });
  const [claiming, setClaiming] = useState(false);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const loadStatus = useCallback(async () => {
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
        setStatusState({ kind: 'ready', status, canClaim });
      }
    } catch {
      if (requestVersion.current === version) {
        setStatusState({ kind: 'error' });
      }
    }
  }, [salonId]);

  useEffect(() => {
    void loadStatus();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadStatus]);

  const openVerification = useCallback(() => {
    clerk.openUserProfile();
  }, [clerk]);

  const claim = useCallback(async () => {
    if (claiming || statusState.kind !== 'ready' || !statusState.canClaim) {
      return;
    }
    const version = ++requestVersion.current;
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
        setCompletedMessage(status === 'granted' && !hasKnownStarterCredits && statusState.status === 'unclaimed'
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
        setClaiming(false);
      }
    }
  }, [claiming, hasKnownStarterCredits, onClaimed, salonId, statusState]);

  if (statusState.kind === 'loading') {
    return (
      <section aria-labelledby="starter-texts-heading" className="owner-card space-y-3 p-5 text-[var(--owner-ink)]">
        <h3 id="starter-texts-heading" className="text-base font-semibold">Free-text allowance</h3>
        <p role="status" aria-live="polite" className="text-sm leading-relaxed text-[var(--owner-muted)]">Checking free-text allowance…</p>
      </section>
    );
  }

  if (statusState.kind === 'error') {
    return (
      <section aria-labelledby="starter-texts-heading" className="owner-card space-y-3 p-5 text-[var(--owner-ink)]">
        <h3 id="starter-texts-heading" className="text-base font-semibold">Free-text allowance</h3>
        <p role="status" aria-live="polite" className="text-sm leading-relaxed text-[var(--owner-muted)]">We could not check your free-text allowance. Please try again.</p>
        <button type="button" onClick={() => void loadStatus()} className="owner-action w-full sm:w-auto">
          Retry status check
        </button>
      </section>
    );
  }

  if (statusState.status === 'verified') {
    return <p role="status" aria-live="polite" className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm leading-relaxed text-green-800">{completedMessage ?? VERIFIED_MESSAGE}</p>;
  }

  if (!statusState.canClaim) {
    return (
      <section aria-labelledby="starter-texts-heading" className="owner-card space-y-3 p-5 text-[var(--owner-ink)]">
        <h3 id="starter-texts-heading" className="text-base font-semibold">Free-text allowance</h3>
        <p className="text-sm leading-relaxed text-[var(--owner-muted)]">Only the salon owner can verify the free-text allowance. Sign in with the owner account.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="starter-texts-heading" className="owner-card space-y-3 p-5 text-[var(--owner-ink)]">
      <h3 id="starter-texts-heading" className="text-base font-semibold">
        {hasKnownStarterCredits || statusState.status === 'verification_required' ? 'Verify your free-text allowance' : '100 free SMS credits'}
      </h3>
      <p className="text-sm leading-relaxed text-[var(--owner-muted)]">
        {hasKnownStarterCredits || statusState.status === 'verification_required'
          ? 'Link your verified owner email and phone number to your existing lifetime allowance. Your SMS credit balance stays the same.'
          : 'One lifetime allowance linked to your verified owner email and phone number. Creating another salon does not reset it. Long text messages may use more than one SMS credit.'}
      </p>
      <button type="button" onClick={() => void claim()} disabled={claiming} className="owner-action owner-action--primary w-full disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none sm:w-auto">
        {claiming ? 'Verifying…' : hasKnownStarterCredits || statusState.status === 'verification_required' ? 'Verify free-text allowance' : 'Claim 100 free texts'}
      </button>
      {needsVerification && (
        <button type="button" onClick={openVerification} className="owner-action w-full sm:w-auto">
          Verify email and phone
        </button>
      )}
      {message && <p role="status" aria-live="polite" className="text-sm leading-relaxed text-[var(--owner-muted)]">{message}</p>}
    </section>
  );
}
