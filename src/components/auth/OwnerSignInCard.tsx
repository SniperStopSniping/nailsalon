'use client';

import { SignIn, useClerk } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveOnboardingOrganization } from '@/features/onboarding-v1-integration/client';

import { lusterOwnerSignInAppearance } from './clerkAppearance';
import { OwnerSignInStatus } from './OwnerSignInStatus';

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
  createSalonUrl?: string;
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
export function OwnerSignInCard({ dashboardUrl, createSalonUrl }: OwnerSignInCardProps) {
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
      appearance={{
        ...lusterOwnerSignInAppearance,
        elements: {
          ...lusterOwnerSignInAppearance.elements,
          ...(createSalonUrl ? { footerAction__signIn: 'luster-auth-create' } : {}),
        },
      }}
      signUpUrl={createSalonUrl}
      fallbackRedirectUrl={dashboardUrl}
      routing="hash"
    />
  );

  if (!needsOrganization) {
    return signInCard;
  }

  return (
    <OwnerSignInStatus busy={phase === 'resolving'} errorMessage={errorMessage} onRetry={retry}>
      {signInCard}
    </OwnerSignInStatus>
  );
}
