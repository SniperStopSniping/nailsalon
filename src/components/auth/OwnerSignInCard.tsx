'use client';

import { SignIn, SignUp, useClerk } from '@clerk/nextjs';
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
  = 'We couldn’t finish signing you in. Try again.';

export type OwnerSignInCardProps = {
  dashboardUrl: string;
  createSalonUrl?: string;
  mode?: 'sign-in' | 'sign-up';
  signInUrl?: string;
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
export function OwnerSignInCard({ dashboardUrl, createSalonUrl, mode = 'sign-in', signInUrl }: OwnerSignInCardProps) {
  const clerk = useClerk();
  const [pendingTask, setPendingTask] = useState<PendingSessionTask | null>(null);
  const [phase, setPhase] = useState<'failed' | 'resolving'>('resolving');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const mountedRef = useRef(false);
  const pendingTaskRef = useRef<PendingSessionTask | null>(null);
  const attemptedTaskKeysRef = useRef(new Set<string>());
  const inFlightTaskKeysRef = useRef(new Set<string>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const initialTask = derivePendingSessionTask(clerk.session);
    pendingTaskRef.current = initialTask;
    setPendingTask(initialTask);
    return clerk.addListener(({ session: nextSession }) => {
      const nextTask = derivePendingSessionTask(nextSession);
      pendingTaskRef.current = nextTask;
      setPendingTask(nextTask);
    });
  }, [clerk]);

  const needsOrganization = pendingTask?.taskKey === 'choose-organization';

  useEffect(() => {
    if (!needsOrganization || !pendingTask) {
      return;
    }
    const selectedTask = pendingTask;
    const taskKey = `${selectedTask.sessionId}\u0000${selectedTask.taskKey}`;
    if (attemptedTaskKeysRef.current.has(taskKey) || inFlightTaskKeysRef.current.has(taskKey)) {
      return;
    }
    attemptedTaskKeysRef.current.add(taskKey);
    inFlightTaskKeysRef.current.add(taskKey);
    setPhase('resolving');
    setErrorMessage(null);
    void (async () => {
      const isSelectedTask = () => {
        const current = pendingTaskRef.current;
        return mountedRef.current
          && current?.sessionId === selectedTask.sessionId
          && current.taskKey === selectedTask.taskKey;
      };
      const isCurrentTask = () => {
        const rawTask = derivePendingSessionTask(clerk.session);
        return isSelectedTask()
          && rawTask?.sessionId === selectedTask.sessionId
          && rawTask.taskKey === selectedTask.taskKey;
      };
      const showFailure = () => {
        if (isSelectedTask()) {
          setErrorMessage(RESOLUTION_FAILED_MESSAGE);
          setPhase('failed');
        }
      };
      try {
        const session = clerk.session as {
          getToken?: (options: { skipCache: true }) => Promise<string | null>;
          id?: string;
        } | null;
        if (!isSelectedTask()) {
          return;
        }
        if (session?.id !== selectedTask.sessionId) {
          showFailure();
          return;
        }
        if (typeof session.getToken !== 'function') {
          throw new TypeError(RESOLUTION_FAILED_MESSAGE);
        }
        let sessionToken: string | null;
        try {
          sessionToken = await session.getToken({ skipCache: true });
        } catch {
          throw new TypeError(RESOLUTION_FAILED_MESSAGE);
        }
        if (!isCurrentTask()) {
          showFailure();
          return;
        }
        if (!sessionToken) {
          throw new Error(RESOLUTION_FAILED_MESSAGE);
        }
        // The salon name is not readable yet: use the endpoint's fallback.
        // This genuine pending-session token is scoped to organization setup.
        const resolution = await resolveOnboardingOrganization('', { sessionToken });
        if (!isCurrentTask()) {
          showFailure();
          return;
        }
        const [organization] = resolution.organizations;
        if (!organization) {
          throw new Error(RESOLUTION_FAILED_MESSAGE);
        }
        await clerk.setActive({
          organization: organization.id,
          redirectUrl: dashboardUrl,
          session: selectedTask.sessionId,
        });
      } catch {
        showFailure();
      } finally {
        inFlightTaskKeysRef.current.delete(taskKey);
      }
    })();
  }, [clerk, dashboardUrl, needsOrganization, pendingTask, retryCount]);

  const retry = useCallback(() => {
    const task = pendingTaskRef.current;
    if (task) {
      attemptedTaskKeysRef.current.delete(`${task.sessionId}\u0000${task.taskKey}`);
    }
    setPhase('resolving');
    setErrorMessage(null);
    setRetryCount(count => count + 1);
  }, []);

  const signInCard = mode === 'sign-up'
    ? (
        <SignUp appearance={lusterOwnerSignInAppearance} signInUrl={signInUrl} forceRedirectUrl={dashboardUrl} routing="hash" />
      )
    : (
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
