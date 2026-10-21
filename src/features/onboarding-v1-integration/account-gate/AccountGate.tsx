'use client';

import {
  HandleSSOCallback,
  useClerk,
  useSignUp,
  useUser,
} from '@clerk/nextjs';
import { useSignIn } from '@clerk/nextjs/legacy';
import {
  ArrowLeft,
  Cloud,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { SiteBuilderDocument } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import { SITE_PALETTE_BY_ID } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/palettes';
import { getSiteStyleLabel } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/site-styles';
import type { OnboardingLabState } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import { OnboardingSitePreview } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/preview/OnboardingSitePreview';
import { getOnboardingIntegrationRoute } from '../account-history';
import type { OnboardingAuthProviderAvailability } from '../auth-providers';
import { OnboardingIntegrationRequestError, resolveOnboardingOrganization } from '../client';
import { describeClerkError, getClerkErrorCode } from './clerk-errors';
import { AppleMark, GoogleMark } from './provider-marks';

type OAuthProviderStrategy = 'oauth_apple' | 'oauth_google';

type GateIntent = 'sign-in' | 'sign-up';

type GateStep =
  | { kind: 'email' }
  | { kind: 'finalizing' }
  | { kind: 'org'; organizations: { id: string; name: string }[]; sessionId: string }
  | { kind: 'password'; email: string; mode: 'existing' | 'new' }
  | { kind: 'providers' }
  | { kind: 'reset-code'; email: string }
  | { kind: 'reset-password'; email: string }
  | { kind: 'setup-error'; message: string; retryable: boolean; sessionId?: string }
  | { kind: 'sso'; provider: OAuthProviderStrategy }
  | { kind: 'verify-sign-up'; email: string };

const RESEND_COOLDOWN_MS = 30_000;
const ORGANIZATION_SETUP_UNAVAILABLE_MESSAGE = 'We couldn’t finish setting up your business right now. Your work is still safe on this device. Please contact Luster support.';
const ORGANIZATION_SIGN_IN_AGAIN_MESSAGE = 'We couldn’t activate your business. Sign in again to continue.';
const ORGANIZATION_SESSION_ENDED_MESSAGE = 'Your sign-in session ended. Sign in again to continue.';
const ENDED_SESSION_STATUSES = new Set(['abandoned', 'ended', 'expired', 'removed', 'replaced', 'revoked']);

type PendingSessionTask = {
  sessionId: string;
  taskKey: string;
};

/**
 * Clerk's React hooks hide pending sessions (they are treated as signed
 * out), but resolving the choose-organization task requires seeing one. The
 * raw session resource carries `status` and `currentTask`.
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

export type PremiumAccountGateProps = {
  authMode: GateIntent;
  document: SiteBuilderDocument;
  errorMessage: string | null;
  locale: string;
  needsSessionEmailVerification: boolean;
  onCancel: () => void;
  onSessionEmailVerified?: () => void;
  providers: OnboardingAuthProviderAvailability;
  state: OnboardingLabState;
};

export function PremiumAccountGate({
  authMode,
  document,
  errorMessage,
  locale,
  needsSessionEmailVerification,
  onCancel,
  onSessionEmailVerified,
  providers,
  state,
}: PremiumAccountGateProps) {
  const clerk = useClerk();
  const { isLoaded: signInLoaded, setActive, signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { user } = useUser();

  const [intent, setIntent] = useState<GateIntent>(authMode);
  const [step, setStep] = useState<GateStep>({ kind: 'providers' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(() => (
    typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('clerk-sign-up') === 'failed'
      ? 'We couldn’t complete sign-up. Try again.'
      : null
  ));
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [emailValue, setEmailValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [codeValue, setCodeValue] = useState('');
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [ssoCallback] = useState(() =>
    new URLSearchParams(window.location.search).has('sso'));
  const [pendingTask, setPendingTask] = useState<PendingSessionTask | null>(null);

  const orgAttemptedKeysRef = useRef(new Set<string>());
  const orgResolutionInFlightKeysRef = useRef(new Set<string>());
  const signUpFinalizationSupersededRef = useRef(false);
  const pendingTaskRef = useRef<PendingSessionTask | null>(null);
  const mountedRef = useRef(true);
  const signOutInFlightRef = useRef(false);
  const sessionVerifyPreparedRef = useRef(false);
  const focusTargetRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const onboardingRoute = getOnboardingIntegrationRoute(locale);
  const claimUrl = `${onboardingRoute}?claim=1`;
  const salonName = state.profile.businessName.trim() || 'Your nail studio';
  const selectedServices = state.profile.serviceMenu.selectedServiceIds.length;
  const isEarlySave = state.progress.currentScreen === 'save_progress';
  const clerkReady = signInLoaded;

  const sessionEmail = user?.primaryEmailAddress;
  const showSessionVerify = needsSessionEmailVerification && Boolean(sessionEmail);

  const clearTransient = useCallback(() => {
    setFormError(null);
    setStatusNote(null);
  }, []);

  const moveToStep = useCallback((next: GateStep) => {
    setStep(next);
    setFormError(null);
    setStatusNote(null);
    setCodeValue('');
  }, []);

  useEffect(() => {
    if (step.kind === 'email' || step.kind === 'password' || step.kind === 'reset-password') {
      focusTargetRef.current?.focus();
      return;
    }
    if (step.kind === 'verify-sign-up' || step.kind === 'reset-code' || showSessionVerify) {
      focusTargetRef.current?.focus();
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [showSessionVerify, step.kind]);

  // An already-signed-in owner whose email is unverified stays inside this
  // gate: send one verification code for the session's primary email.
  useEffect(() => {
    if (!showSessionVerify || !sessionEmail || sessionVerifyPreparedRef.current) {
      return;
    }
    sessionVerifyPreparedRef.current = true;
    void sessionEmail
      .prepareVerification({ strategy: 'email_code' })
      .catch(() => {
        setFormError('We couldn’t send a verification code. Use “Send a new code” to try again.');
      });
  }, [sessionEmail, showSessionVerify]);

  // Clerk's hooks treat pending sessions as signed out, so the raw session
  // resource is observed directly to notice a pending task.
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
      if (!mountedRef.current) {
        return;
      }
      const nextTask = derivePendingSessionTask(nextSession);
      const previousTask = pendingTaskRef.current;
      pendingTaskRef.current = nextTask;
      setPendingTask(nextTask);
      const nextStatus = nextSession && typeof nextSession === 'object'
        ? (nextSession as { status?: unknown }).status
        : null;
      const ended = nextSession === null || nextSession === undefined
        || (typeof nextStatus === 'string' && ENDED_SESSION_STATUSES.has(nextStatus));
      if (nextTask || ended) {
        signUpFinalizationSupersededRef.current = true;
      }
      if (previousTask && !nextTask && ended) {
        setStep({ kind: 'providers' });
        setFormError(ORGANIZATION_SESSION_ENDED_MESSAGE);
      }
    });
  }, [clerk]);

  const resolvePendingOrganization = useCallback(async (
    task: PendingSessionTask,
    explicitRetry = false,
  ) => {
    const taskKey = `${task.sessionId}\u0000${task.taskKey}`;
    if (orgResolutionInFlightKeysRef.current.has(taskKey)) {
      return;
    }
    if (!explicitRetry && orgAttemptedKeysRef.current.has(taskKey)) {
      return;
    }
    orgAttemptedKeysRef.current.add(taskKey);
    orgResolutionInFlightKeysRef.current.add(taskKey);
    setFormError(null);
    setStep({ kind: 'finalizing' });

    const isCurrentTask = () => {
      const current = pendingTaskRef.current;
      const rawTask = derivePendingSessionTask(clerk.session);
      return rawTask?.sessionId === task.sessionId
        && rawTask.taskKey === task.taskKey
        && mountedRef.current
        && current?.sessionId === task.sessionId
        && current.taskKey === task.taskKey;
    };

    try {
      // Pending sessions may not have Clerk's active-session cookie marker.
      // Use their genuine session JWT for this one pending-task endpoint;
      // Clerk still verifies it on the server and salon claiming stays gated.
      const session = clerk.session;
      if (!isCurrentTask() || !session || session.id !== task.sessionId) {
        return;
      }
      let sessionToken: string | null;
      try {
        sessionToken = await session.getToken({ skipCache: true });
      } catch {
        throw new OnboardingIntegrationRequestError(
          'We couldn’t confirm your sign-in. Please try again.',
          { code: 'SESSION_TOKEN_UNAVAILABLE', status: 503 },
        );
      }
      if (!isCurrentTask()) {
        return;
      }
      if (!sessionToken) {
        throw new OnboardingIntegrationRequestError(
          ORGANIZATION_SIGN_IN_AGAIN_MESSAGE,
          { code: 'UNAUTHENTICATED', status: 401 },
        );
      }
      const resolution = await resolveOnboardingOrganization(salonName, { sessionToken });
      if (!isCurrentTask()) {
        return;
      }
      const [firstOrganization] = resolution.organizations;
      if (resolution.organizations.length === 1 && firstOrganization) {
        try {
          await clerk.setActive({
            organization: firstOrganization.id,
            session: task.sessionId,
          });
        } catch {
          if (isCurrentTask()) {
            setStep({
              kind: 'setup-error',
              message: ORGANIZATION_SIGN_IN_AGAIN_MESSAGE,
              retryable: false,
              sessionId: task.sessionId,
            });
          }
        }
        return;
      }
      setStep({ kind: 'org', organizations: resolution.organizations, sessionId: task.sessionId });
    } catch (error) {
      if (!isCurrentTask()) {
        return;
      }
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
      const unavailable = code === 'ORGANIZATION_SETUP_UNAVAILABLE'
        || code === 'organization_quota_exceeded'
        || code === 'ORGANIZATION_QUOTA_EXCEEDED';
      const status = error && typeof error === 'object' && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : null;
      const sessionExpired = status === 401
        || ['UNAUTHENTICATED', 'SESSION_EXPIRED', 'session_expired', 'unauthenticated'].includes(code);
      setStep({
        kind: 'setup-error',
        message: unavailable
          ? ORGANIZATION_SETUP_UNAVAILABLE_MESSAGE
          : sessionExpired
            ? ORGANIZATION_SIGN_IN_AGAIN_MESSAGE
            : error instanceof Error && error.message.trim()
              ? error.message
              : 'We couldn’t finish setting up your business. Please try again.',
        retryable: !unavailable && !sessionExpired,
        sessionId: sessionExpired ? task.sessionId : undefined,
      });
    } finally {
      orgResolutionInFlightKeysRef.current.delete(taskKey);
    }
  }, [clerk, salonName]);

  // A pending session with the choose-organization task never shows a
  // generic Clerk screen: the business shell is resolved server-side, named
  // after the salon, and activated here. Luster's own salon membership
  // remains the tenancy authority.
  useEffect(() => {
    if (!pendingTask || pendingTask.taskKey !== 'choose-organization') {
      return;
    }
    void resolvePendingOrganization(pendingTask);
  }, [pendingTask, resolvePendingOrganization]);

  const retryOrganizationSetup = useCallback(() => {
    if (pendingTask?.taskKey === 'choose-organization') {
      void resolvePendingOrganization(pendingTask, true);
    }
  }, [pendingTask, resolvePendingOrganization]);

  const signInAgain = useCallback(async (sessionId: string) => {
    const current = pendingTaskRef.current;
    if (
      signOutInFlightRef.current
      || !mountedRef.current
      || current?.sessionId !== sessionId
      || current.taskKey !== 'choose-organization'
    ) {
      return;
    }
    signOutInFlightRef.current = true;
    setBusy(true);
    try {
      await clerk.signOut({ sessionId, redirectUrl: claimUrl });
      const latest = pendingTaskRef.current;
      if (mountedRef.current && latest?.sessionId === sessionId) {
        pendingTaskRef.current = null;
        setPendingTask(null);
        setStep({ kind: 'providers' });
        setFormError(ORGANIZATION_SESSION_ENDED_MESSAGE);
      }
    } catch {
      if (mountedRef.current && pendingTaskRef.current?.sessionId === sessionId) {
        setFormError('We couldn’t restart sign-in. Please try again.');
      }
    } finally {
      signOutInFlightRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }, [claimUrl, clerk]);

  const startOAuth = useCallback(async (provider: OAuthProviderStrategy) => {
    if (busy || (intent === 'sign-in' && !signIn)) {
      return;
    }
    setBusy(true);
    clearTransient();
    setStep({ kind: 'sso', provider });
    try {
      if (intent === 'sign-up') {
        const callbackUrl = `${onboardingRoute}?sso=1`;
        const { error } = await signUp.sso({
          redirectCallbackUrl: callbackUrl,
          redirectUrl: callbackUrl,
          strategy: provider,
        });
        if (error) {
          throw error;
        }
      } else {
        const currentSignIn = signIn;
        if (!currentSignIn) {
          throw new Error('Clerk sign-in is not ready.');
        }
        await currentSignIn.authenticateWithRedirect({
          redirectUrl: `${onboardingRoute}?sso=1`,
          redirectUrlComplete: claimUrl,
          strategy: provider,
        });
      }
    } catch (error) {
      setBusy(false);
      setStep({ kind: 'providers' });
      setFormError(describeClerkError(
        error,
        provider === 'oauth_apple'
          ? 'We couldn’t open Apple sign-in. Try again.'
          : 'We couldn’t open Google sign-in. Try again.',
      ));
    }
  }, [busy, claimUrl, clearTransient, intent, onboardingRoute, signIn, signUp]);

  const submitEmail = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const email = emailValue.trim();
    if (!signIn || busy || !email) {
      return;
    }
    setBusy(true);
    clearTransient();
    try {
      await signIn.create({ identifier: email });
      moveToStep({ email, kind: 'password', mode: 'existing' });
    } catch (error) {
      const code = getClerkErrorCode(error);
      if (code === 'form_identifier_not_found') {
        moveToStep({ email, kind: 'password', mode: 'new' });
      } else {
        setFormError(describeClerkError(error, 'We couldn’t check that email. Try again.'));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, clearTransient, emailValue, moveToStep, signIn]);

  const submitPassword = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (step.kind !== 'password' || busy || !passwordValue) {
      return;
    }
    setBusy(true);
    clearTransient();
    try {
      if (step.mode === 'new') {
        const { error } = await signUp.password({
          emailAddress: step.email,
          password: passwordValue,
        });
        if (error) {
          throw error;
        }
        if (signUp.status === 'complete') {
          // Instances that don't require the email attribute complete the
          // sign-up immediately with the address still unverified. Activate
          // the session; the controller then holds the flow in the
          // verification step until the email is genuinely verified — the
          // claim never starts early.
          signUpFinalizationSupersededRef.current = false;
          setStep({ kind: 'finalizing' });
          const finalized = await signUp.finalize();
          if (finalized.error) {
            if (!signUpFinalizationSupersededRef.current) {
              setStep(current => current.kind === 'finalizing' ? step : current);
              setFormError(describeClerkError(
                finalized.error,
                'Your account was created, but we couldn’t sign you in. Try again.',
              ));
            }
          }
        } else {
          const verification = await signUp.verifications.sendEmailCode();
          if (verification.error) {
            throw verification.error;
          }
          setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS);
          moveToStep({ email: step.email, kind: 'verify-sign-up' });
        }
      } else {
        if (!signIn || !setActive) {
          return;
        }
        const result = await signIn.create({
          identifier: step.email,
          password: passwordValue,
          strategy: 'password',
        });
        if (result.status === 'complete') {
          setStep({ kind: 'finalizing' });
          await setActive({ session: result.createdSessionId });
        } else {
          setFormError('We couldn’t finish signing you in. Try again.');
        }
      }
    } catch (error) {
      setFormError(describeClerkError(
        error,
        step.mode === 'new'
          ? 'We couldn’t create your account. Try again.'
          : 'We couldn’t sign you in. Check your password and try again.',
      ));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    clearTransient,
    moveToStep,
    passwordValue,
    setActive,
    signIn,
    signUp,
    step,
  ]);

  const submitSignUpCode = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const code = codeValue.trim();
    if (step.kind !== 'verify-sign-up' || busy || !code) {
      return;
    }
    setBusy(true);
    clearTransient();
    try {
      const { error } = await signUp.verifications.verifyEmailCode({ code });
      if (error) {
        setFormError(describeClerkError(error, 'We couldn’t verify your email. Try again.'));
        return;
      }
      if (signUp.status === 'complete') {
        try {
          signUpFinalizationSupersededRef.current = false;
          setStep({ kind: 'finalizing' });
          const finalized = await signUp.finalize();
          if (finalized.error) {
            if (!signUpFinalizationSupersededRef.current) {
              setStep(current => current.kind === 'finalizing' ? step : current);
              setFormError(describeClerkError(
                finalized.error,
                'Your email was verified, but we couldn’t sign you in. Try again.',
              ));
            }
          }
        } catch (error) {
          if (!signUpFinalizationSupersededRef.current) {
            setStep(current => current.kind === 'finalizing' ? step : current);
            setFormError(describeClerkError(error, 'Your email was verified, but we couldn’t sign you in. Try again.'));
          }
        }
      } else if (signUp.verifications.emailAddress.status === 'verified') {
        setFormError('Your email was verified, but your account still needs another verification step. Try again to continue.');
      } else {
        setFormError('We couldn’t finish creating your account. Your work is safe on this device. Try again to continue.');
      }
    } catch (error) {
      setFormError(describeClerkError(error, 'We couldn’t verify your email. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [busy, clearTransient, codeValue, signUp, step]);

  const submitSessionCode = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const code = codeValue.trim();
    if (!sessionEmail || busy || !code || !user) {
      return;
    }
    setBusy(true);
    clearTransient();
    try {
      const result = await sessionEmail.attemptVerification({ code });
      if (result.verification.status !== 'verified') {
        setFormError('That code didn’t finish verification. Send a new code and try again.');
        return;
      }
      setStep({ kind: 'finalizing' });
      await user.reload();
      onSessionEmailVerified?.();
    } catch (error) {
      setFormError(describeClerkError(error, 'That code doesn’t match. Check the newest email and try again.'));
    } finally {
      setBusy(false);
    }
  }, [busy, clearTransient, codeValue, onSessionEmailVerified, sessionEmail, user]);

  const resendCode = useCallback(async () => {
    if (busy || Date.now() < resendAvailableAt) {
      return;
    }
    setBusy(true);
    clearTransient();
    try {
      if (showSessionVerify && sessionEmail) {
        await sessionEmail.prepareVerification({ strategy: 'email_code' });
      } else if (step.kind === 'verify-sign-up') {
        const { error } = await signUp.verifications.sendEmailCode();
        if (error) {
          throw error;
        }
      } else if (step.kind === 'reset-code' && signIn) {
        await signIn.create({
          identifier: step.email,
          strategy: 'reset_password_email_code',
        });
      }
      setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS);
      setStatusNote('A new code is on its way.');
    } catch (error) {
      setFormError(describeClerkError(error, 'We couldn’t send a new code. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }, [busy, clearTransient, resendAvailableAt, sessionEmail, showSessionVerify, signIn, signUp, step]);

  const startPasswordReset = useCallback(async () => {
    if (step.kind !== 'password' || busy || !signIn) {
      return;
    }
    setBusy(true);
    clearTransient();
    try {
      await signIn.create({
        identifier: step.email,
        strategy: 'reset_password_email_code',
      });
      setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS);
      moveToStep({ email: step.email, kind: 'reset-code' });
    } catch (error) {
      setFormError(describeClerkError(error, 'We couldn’t start a password reset. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [busy, clearTransient, moveToStep, signIn, step]);

  const submitResetCode = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const code = codeValue.trim();
    if (step.kind !== 'reset-code' || busy || !code || !signIn) {
      return;
    }
    setBusy(true);
    clearTransient();
    try {
      const result = await signIn.attemptFirstFactor({
        code,
        strategy: 'reset_password_email_code',
      });
      if (result.status === 'needs_new_password') {
        setPasswordValue('');
        moveToStep({ email: step.email, kind: 'reset-password' });
      } else if (result.status === 'complete' && setActive) {
        setStep({ kind: 'finalizing' });
        await setActive({ session: result.createdSessionId });
      } else {
        setFormError('That code didn’t finish verification. Send a new code and try again.');
      }
    } catch (error) {
      setFormError(describeClerkError(error, 'That code doesn’t match. Check the newest email and try again.'));
    } finally {
      setBusy(false);
    }
  }, [busy, clearTransient, codeValue, moveToStep, setActive, signIn, step]);

  const submitNewPassword = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (step.kind !== 'reset-password' || busy || !passwordValue || !signIn || !setActive) {
      return;
    }
    setBusy(true);
    clearTransient();
    try {
      const result = await signIn.resetPassword({ password: passwordValue });
      if (result.status === 'complete') {
        setStep({ kind: 'finalizing' });
        await setActive({ session: result.createdSessionId });
      } else {
        setFormError('We couldn’t finish updating your password. Try again.');
      }
    } catch (error) {
      setFormError(describeClerkError(error, 'We couldn’t save that password. Choose a different one.'));
    } finally {
      setBusy(false);
    }
  }, [busy, clearTransient, passwordValue, setActive, signIn, step]);

  const chooseOrganization = useCallback(async (organizationId: string) => {
    const currentTask = pendingTaskRef.current;
    if (
      !pendingTask || busy || !mountedRef.current
      || pendingTask.taskKey !== 'choose-organization'
      || currentTask?.sessionId !== pendingTask.sessionId
      || currentTask.taskKey !== pendingTask.taskKey
      || step.kind !== 'org' || step.sessionId !== pendingTask.sessionId
      || !step.organizations.some(organization => organization.id === organizationId)
    ) {
      return;
    }
    const selectedTask = pendingTask;
    setBusy(true);
    clearTransient();
    try {
      await clerk.setActive({ organization: organizationId, session: selectedTask.sessionId });
      const current = pendingTaskRef.current;
      if (current?.sessionId === selectedTask.sessionId && current.taskKey === selectedTask.taskKey) {
        setStep({ kind: 'finalizing' });
      }
    } catch {
      const current = pendingTaskRef.current;
      if (current?.sessionId === selectedTask.sessionId && current.taskKey === selectedTask.taskKey) {
        setFormError('We couldn’t open that business. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, clearTransient, clerk, pendingTask, step]);

  if (ssoCallback) {
    return (
      <GateShell>
        <div className="onboarding-gate__panel is-quiet" data-entrance="1">
          <span className="onboarding-integration-spinner is-large is-on-dark" aria-hidden="true" />
          <h1 className="onboarding-gate__step-title" ref={headingRef} tabIndex={-1}>
            Finishing sign-in…
          </h1>
          <p className="onboarding-gate__support">
            Your work stays safe on this device until saving is complete.
          </p>
          <HandleSSOCallback
            navigateToApp={({ decorateUrl }) => {
              window.location.assign(decorateUrl(claimUrl));
            }}
            navigateToSignIn={() => {
              window.location.assign(`${onboardingRoute}?auth=sign-in`);
            }}
            navigateToSignUp={() => {
              window.location.assign(`${onboardingRoute}?auth=sign-up&clerk-sign-up=failed`);
            }}
          />
        </div>
      </GateShell>
    );
  }

  if (showSessionVerify) {
    return (
      <GateShell>
        <CodeStep
          busy={busy}
          codeValue={codeValue}
          email={sessionEmail?.emailAddress ?? ''}
          focusRef={focusTargetRef}
          formError={formError}
          headingRef={headingRef}
          intro="Enter the code we sent to"
          onChangeCode={setCodeValue}
          onChangeEmail={null}
          onResend={resendCode}
          onSubmit={submitSessionCode}
          outro="to confirm it’s yours and finish saving your site."
          resendAvailableAt={resendAvailableAt}
          statusNote={statusNote}
        />
        <GateFooterNote onCancel={onCancel} />
      </GateShell>
    );
  }

  const availableProviders = [
    providers.apple ? 'apple' : null,
    providers.google ? 'google' : null,
    providers.email ? 'email' : null,
  ].filter(Boolean);

  return (
    <GateShell>
      {step.kind === 'providers'
        ? (
            <section className="onboarding-gate__hero" aria-label="Save your site">
              <p className="onboarding-integration-eyebrow is-on-dark" data-entrance="1">
                {intent === 'sign-up' ? 'Step 6 — Save your progress' : 'Welcome back'}
              </p>
              <h1 className="onboarding-gate__title" data-entrance="2" ref={headingRef} tabIndex={-1}>
                {intent === 'sign-up'
                  ? (
                      <>
                        Your site is coming together
                        <span aria-hidden="true">✨</span>
                      </>
                    )
                  : 'Log in to keep building.'}
              </h1>
              <p className="onboarding-gate__support" data-entrance="3">
                {intent === 'sign-up'
                  ? 'Create your free Luster account to save your progress and keep building your online booking site.'
                  : 'Log in to connect this website to your Luster account.'}
              </p>
              {errorMessage
                ? <p className="onboarding-gate__session-note" role="status">{errorMessage}</p>
                : null}
              <div className="onboarding-gate__proof" data-entrance="3">
                <div
                  className="onboarding-gate__thumb"
                >
                  <OnboardingSitePreview
                    document={document}
                    fitAvailable
                    interactionMode="scrollable"
                    label={`Preview of ${salonName}`}
                    quickBookPhase="business"
                    state={state}
                    suppressPageHeadingSemantics
                  />
                </div>
                <p className="onboarding-gate__preview-hint">Swipe to explore your site</p>
                <p className="onboarding-gate__proof-line"><strong>{salonName}</strong></p>
                <p className="onboarding-gate__proof-meta">
                  {getSiteStyleLabel(state.recipe.stylePreset)}
                  {' '}
                  ·
                  {' '}
                  {SITE_PALETTE_BY_ID[state.recipe.palettePreset].label}
                  {selectedServices > 0 ? ` · ${selectedServices} ${selectedServices === 1 ? 'service' : 'services'}` : ''}
                </p>
              </div>
              <ul className="onboarding-gate__benefits" aria-label="Account benefits" data-entrance="4">
                <li>
                  <ShieldCheck aria-hidden="true" size={19} />
                  Fully secure
                </li>
                <li>
                  <Cloud aria-hidden="true" size={19} />
                  Save anytime
                </li>
                <li>
                  <Smartphone aria-hidden="true" size={19} />
                  Access anywhere
                </li>
                <li>
                  <LockKeyhole aria-hidden="true" size={19} />
                  Free to create
                </li>
              </ul>
              {/* OP-002: the card kept sign-up wording after the owner chose
                  "Log in", telling a returning owner to create the account
                  they already have. */}
              <div className="onboarding-gate__account-heading">
                <h2>
                  {intent === 'sign-up'
                    ? 'Create your free account'
                    : 'Log in to your Luster account'}
                </h2>
                <p>
                  {intent === 'sign-up'
                    ? 'No payment required. You can change everything later.'
                    : 'Use the account you already have. Your site saves to it as soon as you log in.'}
                </p>
              </div>
              {formError
                ? <p className="onboarding-gate__error" role="alert">{formError}</p>
                : null}
              <div className="onboarding-gate__actions" data-entrance="4">
                {providers.google
                  ? (
                      <button
                        className="onboarding-gate__provider is-google"
                        disabled={busy || !clerkReady}
                        type="button"
                        onClick={() => {
                          void startOAuth('oauth_google');
                        }}
                      >
                        <GoogleMark />
                        <span>Continue with Google</span>
                      </button>
                    )
                  : null}
                {providers.apple
                  ? (
                      <button
                        className="onboarding-gate__provider is-apple"
                        disabled={busy || !clerkReady}
                        type="button"
                        onClick={() => {
                          void startOAuth('oauth_apple');
                        }}
                      >
                        <AppleMark />
                        <span>Continue with Apple</span>
                      </button>
                    )
                  : null}
                {providers.email
                  ? (
                      <button
                        className="onboarding-gate__provider is-email"
                        disabled={busy || !clerkReady}
                        type="button"
                        onClick={() => moveToStep({ kind: 'email' })}
                      >
                        <Mail aria-hidden="true" size={18} />
                        <span>Continue with email</span>
                      </button>
                    )
                  : null}
                {availableProviders.length === 0
                  ? (
                      <p className="onboarding-gate__error" role="alert">
                        Sign-in isn’t available right now. Your work stays safe on this
                        device — try again shortly.
                      </p>
                    )
                  : null}
              </div>
              <p className="onboarding-gate__switch" data-entrance="5">
                {intent === 'sign-up'
                  ? (
                      <>
                        Already have a Luster account?
                        {' '}
                        <button type="button" onClick={() => setIntent('sign-in')}>Log in</button>
                      </>
                    )
                  : (
                      <>
                        New to Luster?
                        {' '}
                        <button type="button" onClick={() => setIntent('sign-up')}>
                          Create your free account
                        </button>
                      </>
                    )}
              </p>
              <p className="onboarding-gate__reassure" data-entrance="5">
                <LockKeyhole aria-hidden="true" size={15} />
                <span>
                  {intent === 'sign-up'
                    ? 'Free to create · No payment required'
                    : 'Secure log in · Nothing you built is changed'}
                </span>
              </p>
              <p className="onboarding-gate__reassure is-secondary" data-entrance="5">
                Your work stays safe on this device until saving is complete.
              </p>
            </section>
          )
        : null}

      {step.kind === 'email'
        ? (
            <form className="onboarding-gate__panel" onSubmit={submitEmail}>
              <BackToProviders disabled={busy} onBack={() => moveToStep({ kind: 'providers' })} />
              <h1 className="onboarding-gate__step-title" ref={headingRef} tabIndex={-1}>
                {intent === 'sign-up' ? 'Continue with email' : 'Log in with email'}
              </h1>
              <p className="onboarding-gate__support">
                {intent === 'sign-up'
                  ? 'We’ll create your free account, or log you in if you already have one.'
                  : 'Enter the email you use for Luster.'}
              </p>
              <label className="onboarding-gate__label" htmlFor="onboarding-gate-email">
                Email address
              </label>
              <input
                autoComplete="email"
                className="onboarding-gate__input"
                id="onboarding-gate-email"
                inputMode="email"
                name="email"
                ref={focusTargetRef}
                required
                type="email"
                value={emailValue}
                aria-describedby={formError ? 'onboarding-gate-form-error' : undefined}
                onChange={event => setEmailValue(event.target.value)}
              />
              <FormMessages formError={formError} statusNote={statusNote} />
              <button className="onboarding-gate__primary" disabled={busy} type="submit">
                {busy ? 'Checking…' : 'Continue'}
              </button>
              <div id="clerk-captcha" />
            </form>
          )
        : null}

      {step.kind === 'password'
        ? (
            <form className="onboarding-gate__panel" onSubmit={submitPassword}>
              <BackToProviders
                disabled={busy}
                label="Use a different email"
                onBack={() => moveToStep({ kind: 'email' })}
              />
              <h1 className="onboarding-gate__step-title" ref={headingRef} tabIndex={-1}>
                {step.mode === 'new' ? 'Create your password' : 'Enter your password'}
              </h1>
              <p className="onboarding-gate__support">
                {step.mode === 'new'
                  ? (
                      <>
                        We’ll create your free Luster account for
                        {' '}
                        <strong>{step.email}</strong>
                        .
                      </>
                    )
                  : (
                      <>
                        Welcome back — log in as
                        {' '}
                        <strong>{step.email}</strong>
                        .
                      </>
                    )}
              </p>
              <label className="onboarding-gate__label" htmlFor="onboarding-gate-password">
                Password
              </label>
              <input
                autoComplete={step.mode === 'new' ? 'new-password' : 'current-password'}
                className="onboarding-gate__input"
                id="onboarding-gate-password"
                minLength={step.mode === 'new' ? 8 : undefined}
                name="password"
                ref={focusTargetRef}
                required
                type="password"
                value={passwordValue}
                aria-describedby={formError ? 'onboarding-gate-form-error' : undefined}
                onChange={event => setPasswordValue(event.target.value)}
              />
              <FormMessages formError={formError} statusNote={statusNote} />
              <button className="onboarding-gate__primary" disabled={busy} type="submit">
                {busy
                  ? (step.mode === 'new' ? 'Creating your account…' : 'Logging in…')
                  : (step.mode === 'new' ? 'Create account and continue' : 'Log in and save my site')}
              </button>
              {step.mode === 'existing'
                ? (
                    <button
                      className="onboarding-gate__text-action"
                      disabled={busy}
                      type="button"
                      onClick={() => {
                        void startPasswordReset();
                      }}
                    >
                      Forgot password?
                    </button>
                  )
                : null}
              <div id="clerk-captcha" />
            </form>
          )
        : null}

      {step.kind === 'verify-sign-up'
        ? (
            <CodeStep
              busy={busy}
              codeValue={codeValue}
              email={step.email}
              focusRef={focusTargetRef}
              formError={formError}
              headingRef={headingRef}
              intro="Enter the code we sent to"
              onChangeCode={setCodeValue}
              onChangeEmail={() => moveToStep({ kind: 'email' })}
              onResend={resendCode}
              onSubmit={submitSignUpCode}
              outro="to finish creating your account."
              resendAvailableAt={resendAvailableAt}
              statusNote={statusNote}
            />
          )
        : null}

      {step.kind === 'reset-code'
        ? (
            <CodeStep
              busy={busy}
              codeValue={codeValue}
              email={step.email}
              focusRef={focusTargetRef}
              formError={formError}
              headingRef={headingRef}
              intro="Enter the password-reset code we sent to"
              onChangeCode={setCodeValue}
              onChangeEmail={() => moveToStep({ kind: 'email' })}
              onResend={resendCode}
              onSubmit={submitResetCode}
              outro="."
              resendAvailableAt={resendAvailableAt}
              statusNote={statusNote}
            />
          )
        : null}

      {step.kind === 'reset-password'
        ? (
            <form className="onboarding-gate__panel" onSubmit={submitNewPassword}>
              <h1 className="onboarding-gate__step-title" ref={headingRef} tabIndex={-1}>
                Choose a new password
              </h1>
              <p className="onboarding-gate__support">
                You’re verified. Set a new password for
                {' '}
                <strong>{step.email}</strong>
                .
              </p>
              <label className="onboarding-gate__label" htmlFor="onboarding-gate-new-password">
                New password
              </label>
              <input
                autoComplete="new-password"
                className="onboarding-gate__input"
                id="onboarding-gate-new-password"
                minLength={8}
                name="new-password"
                ref={focusTargetRef}
                required
                type="password"
                value={passwordValue}
                aria-describedby={formError ? 'onboarding-gate-form-error' : undefined}
                onChange={event => setPasswordValue(event.target.value)}
              />
              <FormMessages formError={formError} statusNote={statusNote} />
              <button className="onboarding-gate__primary" disabled={busy} type="submit">
                {busy ? 'Saving…' : 'Save password and continue'}
              </button>
            </form>
          )
        : null}

      {step.kind === 'org'
        ? (
            <section className="onboarding-gate__panel">
              <h1 className="onboarding-gate__step-title" ref={headingRef} tabIndex={-1}>
                Choose your business
              </h1>
              <p className="onboarding-gate__support">
                Your account is connected to more than one business. Choose where to
                continue.
              </p>
              <FormMessages formError={formError} statusNote={statusNote} />
              <div className="onboarding-gate__org-options" role="group" aria-label="Your businesses">
                {step.organizations.map(organization => (
                  <button
                    disabled={busy}
                    key={organization.id}
                    type="button"
                    onClick={() => {
                      void chooseOrganization(organization.id);
                    }}
                  >
                    {organization.name}
                  </button>
                ))}
              </div>
            </section>
          )
        : null}

      {step.kind === 'setup-error'
        ? (
            <section className="onboarding-gate__panel">
              <h1 className="onboarding-gate__step-title" ref={headingRef} tabIndex={-1}>
                Business setup needs attention
              </h1>
              <p className="onboarding-gate__error" role="alert">{step.message}</p>
              <FormMessages formError={formError} statusNote={statusNote} />
              {step.retryable
                ? (
                    <button
                      className="onboarding-gate__primary"
                      disabled={busy}
                      type="button"
                      onClick={retryOrganizationSetup}
                    >
                      {busy ? 'Trying again…' : 'Retry business setup'}
                    </button>
                  )
                : null}
              {step.sessionId
                ? (
                    <button
                      className="onboarding-gate__primary"
                      disabled={busy}
                      type="button"
                      onClick={() => {
                        void signInAgain(step.sessionId as string);
                      }}
                    >
                      {busy ? 'Signing out…' : 'Sign in again'}
                    </button>
                  )
                : null}
            </section>
          )
        : null}

      {step.kind === 'sso' || step.kind === 'finalizing'
        ? (
            <div className="onboarding-gate__panel is-quiet" aria-busy="true" aria-live="polite">
              <span className="onboarding-integration-spinner is-large is-on-dark" aria-hidden="true" />
              <h1 className="onboarding-gate__step-title" ref={headingRef} tabIndex={-1}>
                {step.kind === 'sso'
                  ? (step.provider === 'oauth_apple' ? 'Continuing with Apple…' : 'Continuing with Google…')
                  : 'Setting up your account…'}
              </h1>
              <p className="onboarding-gate__support">
                Your work stays safe on this device until saving is complete.
              </p>
              {formError
                ? <p className="onboarding-gate__error" role="alert">{formError}</p>
                : null}
            </div>
          )
        : null}

      <GateFooterNote label={isEarlySave ? 'Back' : 'Return to Review'} onCancel={onCancel} />
    </GateShell>
  );
}

function GateShell({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    // Account Gate replaces the onboarding surface in place. Reset every
    // document scroll root before paint so Screen 6 always begins with its
    // reward headline instead of inheriting Screen 5's scroll position.
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = 0;
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  return (
    <main className="onboarding-integration-owner is-account">
      <div className="onboarding-gate">
        <div className="onboarding-gate__glow" aria-hidden="true" />
        <div className="onboarding-integration-owner__brand is-on-dark" aria-label="Luster">
          <Sparkles aria-hidden="true" size={20} />
          <span>Luster</span>
        </div>
        <div className="onboarding-gate__column">
          {children}
        </div>
      </div>
    </main>
  );
}

function GateFooterNote({ label = 'Return to Review', onCancel }: { label?: string; onCancel: () => void }) {
  return (
    <p className="onboarding-gate__footer">
      <button className="onboarding-gate__text-action" type="button" onClick={onCancel}>
        {label}
      </button>
    </p>
  );
}

function BackToProviders({
  disabled,
  label = 'All sign-in options',
  onBack,
}: {
  disabled: boolean;
  label?: string;
  onBack: () => void;
}) {
  return (
    <button
      className="onboarding-gate__back"
      disabled={disabled}
      type="button"
      onClick={onBack}
    >
      <ArrowLeft aria-hidden="true" size={16} />
      {label}
    </button>
  );
}

function FormMessages({
  formError,
  statusNote,
}: {
  formError: string | null;
  statusNote: string | null;
}) {
  return (
    <>
      {formError
        ? (
            <p className="onboarding-gate__error" id="onboarding-gate-form-error" role="alert">
              {formError}
            </p>
          )
        : null}
      {statusNote
        ? <p className="onboarding-gate__status" role="status">{statusNote}</p>
        : null}
    </>
  );
}

function CodeStep({
  busy,
  codeValue,
  email,
  focusRef,
  formError,
  headingRef,
  intro,
  onChangeCode,
  onChangeEmail,
  onResend,
  onSubmit,
  outro,
  resendAvailableAt,
  statusNote,
}: {
  busy: boolean;
  codeValue: string;
  email: string;
  focusRef: React.RefObject<HTMLInputElement | null>;
  formError: string | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  intro: string;
  onChangeCode: (value: string) => void;
  onChangeEmail: (() => void) | null;
  onResend: () => Promise<void> | void;
  onSubmit: (event: FormEvent) => void;
  outro: string;
  resendAvailableAt: number;
  statusNote: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resendAvailableAt <= now) {
      return undefined;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [now, resendAvailableAt]);
  const cooldownSeconds = Math.max(0, Math.ceil((resendAvailableAt - now) / 1_000));

  return (
    <form className="onboarding-gate__panel" onSubmit={onSubmit}>
      <h1 className="onboarding-gate__step-title" ref={headingRef} tabIndex={-1}>
        Check your email
      </h1>
      <p className="onboarding-gate__support">
        {intro}
        {' '}
        <strong>{email}</strong>
        {' '}
        {outro}
      </p>
      <label className="onboarding-gate__label" htmlFor="onboarding-gate-code">
        Verification code
      </label>
      <input
        autoComplete="one-time-code"
        className="onboarding-gate__input is-code"
        id="onboarding-gate-code"
        inputMode="numeric"
        maxLength={8}
        name="code"
        pattern="[0-9]*"
        ref={focusRef}
        required
        type="text"
        value={codeValue}
        aria-describedby={formError ? 'onboarding-gate-form-error' : undefined}
        onChange={event => onChangeCode(event.target.value.replace(/\D/gu, ''))}
      />
      <FormMessages formError={formError} statusNote={statusNote} />
      <button className="onboarding-gate__primary" disabled={busy} type="submit">
        {busy ? 'Verifying…' : 'Verify and save my site'}
      </button>
      <div className="onboarding-gate__code-actions">
        <button
          className="onboarding-gate__text-action"
          disabled={busy || cooldownSeconds > 0}
          type="button"
          onClick={() => {
            void onResend();
          }}
        >
          {cooldownSeconds > 0 ? `Send a new code (${cooldownSeconds}s)` : 'Send a new code'}
        </button>
        {onChangeEmail
          ? (
              <button
                className="onboarding-gate__text-action"
                disabled={busy}
                type="button"
                onClick={onChangeEmail}
              >
                Use a different email
              </button>
            )
          : null}
      </div>
    </form>
  );
}
