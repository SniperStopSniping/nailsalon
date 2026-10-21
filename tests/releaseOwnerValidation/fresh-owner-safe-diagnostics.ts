import type { Page, Response } from '@playwright/test';

const SIGN_UP_STATUSES = new Set(['missing_requirements', 'complete', 'abandoned']);
const APP_PATHS = new Set([
  '/api/onboarding/luster',
  '/api/admin/salon/publish',
  '/api/admin/auth/me',
  '/api/appointments',
  '/api/onboarding/v1/claim',
  '/api/onboarding/v1/status',
  '/api/onboarding/v1/session',
  '/api/onboarding/v1/organization',
  '/admin',
  '/en/admin',
  '/owner-sign-in',
  '/en/owner-sign-in',
]);
const MAX_RECORDS = 80;
const MAX_JSON_BYTES = 256 * 1024;

type SafeRoute = { source: 'app' | 'clerk'; path: string; isSignUpResponse?: boolean };
const SAFE_ERROR_WORDS = new Set(['operation', 'unknown', 'transient', 'reason', 'memory', 'out', 'module', 'script', 'load', 'network', 'timeout', 'database', 'storage', 'quota', 'access', 'denied', 'aborted', 'navigation', 'clerk', 'session', 'token', 'expired', 'hydration', 'internal', 'webkit', 'notfound', 'object', 'state', 'request', 'cancelled', 'indexed', 'failed', 'chunk', 'rejected', 'fetch']);
function safeErrorKeywords(value: string) {
  return [...new Set((value.toLowerCase().match(/[a-z]{3,20}/gu) ?? []).filter(word => SAFE_ERROR_WORDS.has(word)))].slice(0, 12);
}
function safePublicScriptFrames(stack: string | undefined, baseURL: string, frontendApi: string) {
  const frames: Array<{ kind: string; path: string; line: number; column: number }> = [];
  for (const candidate of stack?.match(/https?:\/\/[^\s)]+/gu) ?? []) {
    const frame = candidate.match(/^(.*):(\d{1,7}):(\d{1,7})$/u);
    if (!frame) {
      continue;
    }
    try {
      const url = new URL(frame[1]!);
      const applicationChunk = url.origin === baseURL && /^\/_next\/static\/chunks\/[\w./-]+\.js$/u.test(url.pathname);
      const clerkAsset = url.hostname === frontendApi && /^\/npm\/[\w@./-]+\.js$/u.test(url.pathname);
      if (!applicationChunk && !clerkAsset) {
        continue;
      }
      if (url.pathname.length > 180) {
        continue;
      }
      frames.push({ kind: applicationChunk ? 'owned-public-chunk' : 'clerk-public-asset', path: url.pathname, line: Number(frame[2]), column: Number(frame[3]) });
      if (frames.length >= 3) {
        break;
      }
    } catch { /* No raw URL or stack is retained. */ }
  }
  return frames;
}

function safeIdentifier(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function getSafeRoute(urlValue: string, baseURL: string, frontendApi: string): SafeRoute | null {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }

  if (url.origin === baseURL && APP_PATHS.has(url.pathname)) {
    return { source: 'app', path: url.pathname };
  }
  if (url.protocol !== 'https:' || url.hostname !== frontendApi || url.port) {
    return null;
  }
  if (url.pathname === '/v1/client/sign_ups') {
    return { source: 'clerk', path: '/v1/client/sign_ups', isSignUpResponse: true };
  }
  const clerkPathPatterns: Array<[RegExp, string]> = [
    [/^\/v1\/client$/u, '/v1/client'],
    [/^\/v1\/organizations$/u, '/v1/organizations'],
    [/^\/v1\/organizations\/[^/]+$/u, '/v1/organizations/:id'],
    [/^\/v1\/client\/sign_ups\/[^/]+$/u, '/v1/client/sign_ups/:id'],
    [/^\/v1\/client\/sign_ups\/[^/]+\/(?:prepare_verification|attempt_verification)$/u, '/v1/client/sign_ups/:id/:verification_action'],
    [/^\/v1\/client\/sessions$/u, '/v1/client/sessions'],
    [/^\/v1\/client\/sessions\/[^/]+$/u, '/v1/client/sessions/:id'],
    [/^\/v1\/client\/sessions\/[^/]+\/(?:touch|verify|prepare_first_factor|attempt_first_factor|prepare_second_factor|attempt_second_factor)$/u, '/v1/client/sessions/:id/:session_action'],
  ];
  for (const [pattern, path] of clerkPathPatterns) {
    if (pattern.test(url.pathname)) {
      return { source: 'clerk', path };
    }
  }
  return null;
}

async function readSmallJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await response.body();
    if (body.byteLength > MAX_JSON_BYTES) {
      return null;
    }
    const value: unknown = JSON.parse(body.toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function extractErrorCodes(payload: Record<string, unknown> | null): string[] {
  if (!payload) {
    return [];
  }
  const codes: string[] = [];
  const single = payload.error && typeof payload.error === 'object'
    ? (payload.error as { code?: unknown }).code
    : undefined;
  if (typeof single === 'string' && /^[\w.-]{1,80}$/u.test(single)) {
    codes.push(single);
  }
  if (Array.isArray(payload.errors)) {
    for (const item of payload.errors.slice(0, 12)) {
      const code = item && typeof item === 'object' ? (item as { code?: unknown }).code : undefined;
      if (typeof code === 'string' && /^[\w.-]{1,80}$/u.test(code)) {
        codes.push(code);
      }
    }
  }
  return [...new Set(codes)].slice(0, 12);
}

function signupMetadata(payload: Record<string, unknown> | null) {
  if (!payload) {
    return { signupStatus: null, emailVerified: null, createdSessionPresent: null, createdUserId: null };
  }
  const response = payload.response && typeof payload.response === 'object'
    ? payload.response as Record<string, unknown>
    : payload.sign_up && typeof payload.sign_up === 'object'
      ? payload.sign_up as Record<string, unknown>
      : payload;
  const signupStatus = typeof response.status === 'string' && SIGN_UP_STATUSES.has(response.status)
    ? response.status
    : null;
  const verifications = response.verifications && typeof response.verifications === 'object'
    ? response.verifications as Record<string, unknown>
    : {};
  const emailVerification = (verifications.email_address ?? verifications.emailAddress) as
    | Record<string, unknown>
    | undefined;
  const verificationStatus = emailVerification?.status;
  const emailVerified = verificationStatus === 'verified'
    ? true
    : verificationStatus === 'unverified'
      ? false
      : null;
  const createdSession = response.created_session_id ?? response.createdSessionId;
  return { signupStatus, emailVerified, createdSessionPresent: typeof createdSession === 'string' && createdSession.length > 0, createdUserId: safeIdentifier(response.created_user_id ?? response.createdUserId, /^user_[A-Za-z0-9]+$/u) };
}

export async function readFreshOwnerSignUpMetadata(response: Response) {
  return signupMetadata(await readSmallJson(response));
}

export async function readFreshOwnerClerkState(page: Page) {
  return page.evaluate(() => {
    const clerk = (window as unknown as { Clerk?: {
      loaded?: boolean;
      session?: { status?: unknown; currentTask?: { key?: unknown } } | null;
      user?: {
        primaryEmailAddress?: { verification?: { status?: unknown } } | null;
        emailAddresses?: unknown[];
        createOrganizationEnabled?: unknown;
        organizationMemberships?: unknown[];
      } | null;
    }; }).Clerk;
    const taskKey = clerk?.session?.currentTask?.key;
    const taskKinds = new Set(['choose-organization', 'reset-password', 'setup-mfa']);
    const sessionStatus = clerk?.session?.status;
    const verificationStatus = clerk?.user?.primaryEmailAddress?.verification?.status;
    return {
      clerkLoaded: clerk?.loaded === true,
      sessionPresent: Boolean(clerk?.session),
      sessionStatus: sessionStatus === 'active' || sessionStatus === 'pending' || sessionStatus === 'ended'
        ? sessionStatus
        : null,
      pendingTaskKind: typeof taskKey === 'string' && taskKinds.has(taskKey) ? taskKey : (clerk?.session?.currentTask ? 'unknown' : null),
      userPresent: Boolean(clerk?.user),
      primaryEmailPresent: Boolean(clerk?.user?.primaryEmailAddress),
      emailAddressCount: Math.min(Array.isArray(clerk?.user?.emailAddresses) ? clerk!.user!.emailAddresses!.length : 0, 10),
      primaryEmailVerified: verificationStatus === 'verified' ? true : verificationStatus === 'unverified' ? false : null,
      primaryEmailVerificationStatus: verificationStatus === 'verified' || verificationStatus === 'unverified'
        ? verificationStatus
        : verificationStatus === undefined || verificationStatus === null ? 'missing' : 'other',
      ...(typeof clerk?.user?.createOrganizationEnabled === 'boolean' ? { createOrganizationEnabled: clerk.user.createOrganizationEnabled } : {}),
      ...(Array.isArray(clerk?.user?.organizationMemberships)
        ? { organizationMembershipCount: Math.min(clerk.user.organizationMemberships.length, 20) }
        : {}),
    };
  });
}

export function installFreshOwnerSafeDiagnostics(
  page: Page,
  options: { baseURL: string; frontendApi: string; phase?: () => string; projectName?: string },
) {
  let records = 0;
  const pending = new Set<Promise<void>>();
  const record = (entry: Record<string, unknown>) => {
    if (records >= MAX_RECORDS) {
      return;
    }
    records += 1;
    // eslint-disable-next-line no-console -- fixed safe reporter protocol.
    console.log(`[owner-journey] safe-diagnostic ${JSON.stringify({ ...entry, phase: safeIdentifier(options.phase?.(), /^[a-z][a-z0-9-]{0,79}$/u), project: options.projectName === 'desktop-chromium' || options.projectName === 'iphone-13-webkit' ? options.projectName : null })}`);
  };

  const captureResponse = async (response: Response) => {
    const route = getSafeRoute(response.url(), options.baseURL, options.frontendApi);
    if (!route) {
      return;
    }
    const entry: Record<string, unknown> = {
      type: 'response',
      source: route.source,
      path: route.path,
      status: response.status(),
    };
    const payload = await readSmallJson(response);
    if (route.isSignUpResponse) {
      Object.assign(entry, signupMetadata(payload));
    }
    const errorCodes = extractErrorCodes(payload);
    if (errorCodes.length) {
      entry.errorCodes = errorCodes;
    }
    record(entry);
  };

  page.on('response', (response) => {
    const task = captureResponse(response).catch(() => undefined);
    pending.add(task);
    void task.then(() => pending.delete(task));
  });
  page.on('pageerror', (error) => {
    record({
      type: 'page-exception',
      messageKeywords: safeErrorKeywords(error.message),
      accessControlChecksMentioned: /access control checks|access-control|\bcors\b/iu.test(error.message),
      messageMentionsOwnedOrigin: error.message.includes(options.baseURL),
      messageMentionsClerkFrontend: error.message.includes(options.frontendApi),
      publicScriptFrames: safePublicScriptFrames(error.stack, options.baseURL, options.frontendApi),
      name: safeIdentifier(error.name, /^[A-Za-z][\w.-]{0,63}$/u) ?? 'UnknownError',
      // Classify in memory; never retain free-text messages, stack frames,
      // URLs, cookie values, credentials or synthetic passwords.
      exceptionClass: /indexeddb|indexed database|database.*(?:open|connection)|(?:connection|opening).*database/iu.test(error.message)
        ? 'browser-database'
        : /failed to fetch|networkerror|load failed/iu.test(error.message)
          ? 'network-load'
          : /abort|cancel/iu.test(error.message)
            ? 'cancelled'
            : 'unclassified',
      sourceClass: error.stack?.includes(options.frontendApi)
        ? 'clerk-development'
        : error.stack?.includes(options.baseURL)
          ? 'owned-application'
          : 'browser-or-unknown',
    });
  });
  page.on('requestfailed', (request) => {
    const route = getSafeRoute(request.url(), options.baseURL, options.frontendApi);
    if (!route) {
      return;
    }
    const failure = request.failure()?.errorText ?? '';
    const match = failure.match(/(?:net::)?(ERR_[A-Z0-9_]{1,64})/u);
    record({
      type: 'request-failure',
      source: route.source,
      path: route.path,
      errorCode: match?.[1] ?? 'unknown',
      failureKeywords: safeErrorKeywords(failure),
      isNavigationRequest: request.isNavigationRequest(),
      resourceType: ['document', 'fetch', 'script', 'xhr'].includes(request.resourceType()) ? request.resourceType() : 'other',
      isRscRequest: request.headers().rsc === '1',
    });
  });

  return {
    async captureClerkState(checkpoint: 'after-sign-up-response' | 'post-sign-up-failure' | 'post-sign-up-wait') {
      try {
        const state = await Promise.race([readFreshOwnerClerkState(page), new Promise<null>(resolve => setTimeout(() => resolve(null), 1_500))]);
        record(state ? { type: 'clerk-state', checkpoint, ...state } : { type: 'clerk-state', checkpoint, unavailable: true });
      } catch {
        record({ type: 'clerk-state', checkpoint, unavailable: true });
      }
    },
    async captureFailureCheckpoint() {
      try {
        const snapshot = page.evaluate(({ ownedOrigin }) => {
          const visible = (element: Element) => {
            const node = element as HTMLElement;
            return Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
          };
          const anyVisible = (selector: string) => [...document.querySelectorAll(selector)].some(visible);
          const headingVisible = (pattern: RegExp) => [...document.querySelectorAll('h1,h2,h3')]
            .some(element => visible(element) && pattern.test(element.textContent?.trim() ?? ''));
          const normalizeName = (value: string | null | undefined) => value?.replace(/\s+/gu, ' ').replace(/\s*\*$/u, '').trim().toLowerCase();
          const inputState = (fixedName: string) => {
            const fields = [...document.querySelectorAll<HTMLInputElement>('input')].filter((field) => {
              const names = [field.getAttribute('aria-label'), ...[...(field.labels ?? [])].map(label => label.textContent)];
              for (const id of field.getAttribute('aria-labelledby')?.split(/\s+/u) ?? []) {
                names.push(document.getElementById(id)?.textContent ?? null);
              }
              return visible(field) && names.some(name => normalizeName(name) === fixedName);
            });
            return { visible: fields.length > 0, disabled: fields.length > 0 && fields.every(field => field.disabled || field.getAttribute('aria-disabled') === 'true') };
          };
          const buttonState = (fixedName: RegExp) => {
            const controls = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(button =>
              visible(button) && fixedName.test(normalizeName(button.getAttribute('aria-label') || button.textContent) ?? ''));
            return { visible: controls.length > 0, disabled: controls.length > 0 && controls.every(button => button.disabled || button.getAttribute('aria-disabled') === 'true') };
          };
          const organizationName = inputState('organization name');
          const name = inputState('name');
          const workspaceName = inputState('workspace name');
          const createOrganization = buttonState(/^create (?:an? )?organization$/u);
          const continueControl = buttonState(/^continue$/u);
          const url = new URL(window.location.href);
          const owned = url.origin === ownedOrigin;
          const routeClass = !owned
            ? 'remote'
            : /^(?:\/en)?\/join\/[^/]+$/u.test(url.pathname)
              ? 'owned-join'
              : /^(?:\/en)?\/onboarding\/luster$/u.test(url.pathname)
                ? 'owned-wizard'
                : /^(?:\/en)?\/admin$/u.test(url.pathname)
                  ? 'owned-admin'
                  : /^(?:\/en)?\/owner-sign-in$/u.test(url.pathname) ? 'owned-owner-sign-in' : 'other-owned';
          return { routeClass, ownedOrigin: owned, organizationNameInputVisible: organizationName.visible, organizationNameInputDisabled: organizationName.disabled, nameInputVisible: name.visible, nameInputDisabled: name.disabled, workspaceNameInputVisible: workspaceName.visible, workspaceNameInputDisabled: workspaceName.disabled, createOrganizationControlVisible: createOrganization.visible, createOrganizationControlDisabled: createOrganization.disabled, continueControlVisible: continueControl.visible, continueControlDisabled: continueControl.disabled, createOwnerHeadingVisible: headingVisible(/^Create your owner account$/u), wizardHeadingVisible: headingVisible(/^Set up your salon$/u), organizationTaskHeadingVisible: headingVisible(/(?:set up|setup|create).*organization/iu), verificationCodeInputVisible: anyVisible('input[name="code"]'), emailInputVisible: anyVisible('input[type="email"],input[name="emailAddress"]'), passwordInputVisible: anyVisible('input[type="password"]'), alertVisible: anyVisible('[role="alert"],.cl-formFieldErrorText,.cl-alertText') };
        }, { ownedOrigin: options.baseURL });
        const state = await Promise.race([snapshot, new Promise<null>(resolve => setTimeout(() => resolve(null), 1_500))]);
        record(state ? { type: 'failure-checkpoint', ...state } : { type: 'failure-checkpoint', unavailable: true });
      } catch {
        record({ type: 'failure-checkpoint', unavailable: true });
      }
    },
    async flush() {
      const work = Promise.allSettled([...pending]);
      await Promise.race([work, new Promise(resolve => setTimeout(resolve, 1_000))]);
    },
  };
}
