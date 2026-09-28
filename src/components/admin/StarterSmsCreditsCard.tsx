'use client';

import { useClerk } from '@clerk/nextjs';
import { useCallback, useState } from 'react';

type ClaimStatus = 'granted' | 'already_claimed' | 'verification_required' | 'identity_setup_required';

type StarterSmsCreditsCardProps = {
  salonId: string;
  /** A positive balance identifies a historical starter grant to reconcile. */
  hasKnownStarterCredits: boolean;
  onClaimed: () => Promise<void> | void;
};

/**
 * The free allowance is claimed explicitly. It is intentionally not loaded or
 * granted when this panel opens, and it never asks the owner to type identity
 * data: the route reads verified primary contacts directly from Clerk.
 */
export function StarterSmsCreditsCard({
  salonId,
  hasKnownStarterCredits,
  onClaimed,
}: StarterSmsCreditsCardProps) {
  const clerk = useClerk();
  const [claiming, setClaiming] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const openVerification = useCallback(() => {
    clerk.openUserProfile();
  }, [clerk]);

  const claim = useCallback(async () => {
    if (claiming) {
      return;
    }
    try {
      setClaiming(true);
      setMessage(null);
      setNeedsVerification(false);
      const response = await fetch('/api/admin/salon/communications/starter-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId }),
      });
      const body = await response.json().catch(() => null);
      const status = body?.data?.status as ClaimStatus | undefined;
      if (!response.ok) {
        throw new Error(typeof body?.error?.message === 'string'
          ? body.error.message
          : 'Free texts could not be claimed. Please try again.');
      }
      if (status === 'granted') {
        await onClaimed();
        setHidden(true);
        setCompletedMessage(hasKnownStarterCredits
          ? 'Your free-text allowance has been verified. Your existing SMS credits are unchanged.'
          : '100 free SMS credits have been added.');
        return;
      }
      if (status === 'already_claimed') {
        setHidden(true);
        setCompletedMessage(hasKnownStarterCredits
          ? 'Your free-text allowance has been verified. Your existing SMS credits are unchanged.'
          : 'Your lifetime free-text allowance was already claimed.');
        return;
      }
      if (status === 'verification_required') {
        setNeedsVerification(true);
        setMessage('Verify your primary email and phone number to claim your free texts.');
        return;
      }
      setMessage('Free texts are temporarily unavailable. Please try again later or contact support.');
    } catch (error) {
      setMessage(error instanceof Error && error.message
        ? error.message
        : 'Free texts could not be claimed. Please try again.');
    } finally {
      setClaiming(false);
    }
  }, [claiming, hasKnownStarterCredits, onClaimed, salonId]);

  if (hidden) {
    return completedMessage === null
      ? null
      : (
          <p role="status" aria-live="polite" className="rounded-lg bg-green-50 p-3 text-[14px] text-green-800">
            {completedMessage}
          </p>
        );
  }

  return (
    <section aria-labelledby="starter-texts-heading" className="space-y-2 rounded-lg bg-pink-50 p-4 text-gray-900">
      <h3 id="starter-texts-heading" className="text-[15px] font-medium">
        {hasKnownStarterCredits ? 'Verify your free-text allowance' : '100 free SMS credits'}
      </h3>
      <p className="text-[14px] text-gray-700">
        {hasKnownStarterCredits
          ? 'Link your verified owner email and phone number to your existing lifetime allowance. Your SMS credit balance stays the same.'
          : 'One lifetime allowance linked to your verified owner email and phone number. Creating another salon does not reset it. Long text messages may use more than one SMS credit.'}
      </p>
      <button
        type="button"
        onClick={claim}
        disabled={claiming}
        className="rounded-lg bg-gray-900 px-3 py-2 text-[14px] font-medium text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:opacity-40 motion-reduce:transition-none"
      >
        {claiming
          ? 'Verifying…'
          : hasKnownStarterCredits ? 'Verify free-text allowance' : 'Claim 100 free texts'}
      </button>
      {needsVerification && (
        <button
          type="button"
          onClick={openVerification}
          className="ml-2 rounded-lg border border-gray-300 px-3 py-2 text-[14px] font-medium text-gray-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 motion-reduce:transition-none"
        >
          Verify email and phone
        </button>
      )}
      {message && <p role="status" aria-live="polite" className="text-[13px] text-gray-700">{message}</p>}
    </section>
  );
}
