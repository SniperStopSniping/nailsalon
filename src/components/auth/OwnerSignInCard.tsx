'use client';

import { SignIn, useClerk } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveOnboardingOrganization } from '@/features/onboarding-v1-integration/client';

import { lusterOwnerSignInAppearance } from './clerkAppearance';

type PendingSessionTask = {
  sessionId: string;
  taskKey: string;
};

/**
 * Clerk's React hooks treat a session that still carries a task as signed
 * out, so the raw session resource is observed for `status`/`currentTask`
 * (same mechanism as the onboarding account gate).
 */
const derivePendingSessionTask = (candidate: unknown): PendingSessionTask | null => {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const session = candidate as {
    currentTask?: { key?: unknown };
    id?: unknown;
    status?: unknown;
  };
  if (
    session.status !== 'pending'
    || typeof session.id !== 'string'
    || typeof session.currentTask?.key !== 'string'
  ) {
    return null;
  }
  return { sessionId: session.id, taskKey: session.currentTask.key };
};

const RESOLUTION_FAILED_MESSAGE
  = 'We couldn’t finish opening your workspace. Try again.';

export type OwnerSignInCardProps = {
  dashboardUrl: string;
};

/**
 * The owner sign-in card.
 *
 * Clerk's instance requires an active organization, so a freshly signed-in
 * owner whose account predates that requirement (an invited owner, or anyone
 * who did not come through the onboarding gate) is held in a `pending`
 * session carrying the `choose-organization` task. Clerk's stock answer is a
 * generic "Setup your organization" form, which means nothing in Luster:
 * tenancy lives in the salon membership tables, and the Clerk organization is
 * only a session formality. This resolves the task the same way the
 * onboarding gate does — server-side through
 * `POST /api/onboarding/v1/organization`, then `setActive` — and continues to
 * the workspace, so the owner sees a status message instead of a form.
 */
export function OwnerSignInCard({ dashboardUrl }: OwnerSignInCardProps) {
  const clerk = useClerk();
  const [pendingTask, setPendingTask] = useState<PendingSessionTask | null>(null);
  const [phase, setPhase] = useState<'failed' | 'resolving'>('resolving');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const resolvingRef = useRef(false);

  useEffect(() => {
    setPendingTask(derivePendingSessionTask(clerk.session));
    return clerk.addListener(({ session: nextSession }) => {
      setPendingTask(derivePendingSessionTask(nextSession));
    });
  }, [clerk]);

  const needsOrganization = pendingTask?.taskKey === 'choose-organization';
  const pendingSessionId = pendingTask?.sessionId;

  useEffect(() => {
    if (!needsOrganization || !pendingSessionId || resolvingRef.current) {
      return;
    }
    resolvingRef.current = true;
    setPhase('resolving');
    setErrorMessage(null);
    void (async () => {
      try {
        // The salon name is not readable yet: a pending session is signed out
        // for every other API, so the endpoint's own fallback name is used.
        const resolution = await resolveOnboardingOrganization('');
        const [organization] = resolution.organizations;
        if (!organization) {
          throw new Error(RESOLUTION_FAILED_MESSAGE);
        }
        await clerk.setActive({
          organization: organization.id,
          redirectUrl: dashboardUrl,
          session: pendingSessionId,
        });
      } catch (error) {
        resolvingRef.current = false;
        setErrorMessage(error instanceof Error && error.message.trim()
          ? error.message
          : RESOLUTION_FAILED_MESSAGE);
        setPhase('failed');
      }
    })();
  }, [clerk, dashboardUrl, needsOrganization, pendingSessionId, retryCount]);

  const retry = useCallback(() => {
    setPhase('resolving');
    setErrorMessage(null);
    setRetryCount(count => count + 1);
  }, []);

  const signInCard = (
    <SignIn
      appearance={lusterOwnerSignInAppearance}
      fallbackRedirectUrl={dashboardUrl}
      routing="hash"
    />
  );

  if (!needsOrganization) {
    return signInCard;
  }

  if (phase === 'resolving') {
    return (
      <div
        className="w-full rounded-3xl border border-stone-200 bg-white p-6 shadow-sm"
        role="status"
      >
        <div className="flex items-center justify-center gap-3">
          <span
            aria-hidden="true"
            className="size-4 rounded-full border-2 border-stone-300 border-t-rose-800 motion-safe:animate-spin"
          />
          <p className="text-sm text-stone-700">Opening your workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 rounded-3xl border border-stone-200 bg-white p-6 text-left shadow-sm">
      <p className="text-sm font-semibold text-stone-900">
        We couldn’t open your workspace automatically
      </p>
      <p className="text-sm leading-6 text-stone-600" role="alert">
        {errorMessage}
      </p>
      <button
        className="inline-flex min-h-11 items-center rounded-full bg-rose-800 px-5 text-sm font-medium text-white"
        onClick={retry}
        type="button"
      >
        Try again
      </button>
      <p className="text-xs leading-5 text-stone-500">
        If it keeps failing, finish the step below — your salon is already
        waiting in Luster.
      </p>
      {signInCard}
    </div>
  );
}
