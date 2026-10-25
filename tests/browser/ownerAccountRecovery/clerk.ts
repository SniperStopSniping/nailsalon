// Isolated browser adapter. No Clerk account is created or contacted.
const params = new URLSearchParams(location.search);
const finalizationRecovery = params.get('scenario') === 'finalization-recovery';
const authContext = params.get('scenario') === 'auth-context';
const organizationFocus = params.get('scenario') === 'organization-focus';
const resumed = (finalizationRecovery || organizationFocus || authContext) && params.has('claim');
type Session = { id: string; status: string; currentTask: { key: string } | null; lastActiveOrganizationId: string; getToken?: () => Promise<string> };
type Navigate = (input: { session: Session; decorateUrl: (url: string) => string }) => void;
const session: Session = { id: 'fixture-recovery-session', status: 'active', currentTask: null, lastActiveOrganizationId: 'fixture-existing-org' };
const listeners = new Set<(state: { session: Session }) => void>();
const counts = JSON.parse(sessionStorage.getItem('fixture-finalization-counts') ?? '{"password":0,"finalize":0,"activation":0}') as { password: number; finalize: number; activation: number };
const count = (key: keyof typeof counts) => {
  counts[key] += 1;
  sessionStorage.setItem('fixture-finalization-counts', JSON.stringify(counts));
};
let finishFinalize: (() => void) | undefined;
let finalizeNavigate: Navigate | undefined;
let finishActivation: (() => void) | undefined;
let activationKeys: string[] = [];
let activationSession: string | null = null;
const organizationState = JSON.parse(sessionStorage.getItem('fixture-organization-focus') ?? '{"tokens":0,"activationSession":null,"activationOrganization":null}') as { tokens: number; activationSession: string | null; activationOrganization: string | null };
const saveOrganizationState = () => sessionStorage.setItem('fixture-organization-focus', JSON.stringify(organizationState));
const pendingOrganization: Session = { ...session, status: 'pending', currentTask: { key: 'choose-organization' }, getToken: async () => {
  organizationState.tokens += 1;
  saveOrganizationState();
  return 'fixture-token';
} };
const decorateUrl = (url: string) => `${url}&scenario=${authContext ? 'auth-context' : organizationFocus ? 'organization-focus' : 'finalization-recovery'}&fixtureDecorated=1`;
export const useAuth = () => ({ isLoaded: true, isSignedIn: !(finalizationRecovery || organizationFocus || authContext) || resumed, userId: 'fixture-owner', getToken: async () => 'fixture-token' });
export const useUser = () => ({ isLoaded: true, user: { id: 'fixture-owner', primaryEmailAddress: { emailAddress: 'owner@example.test', verification: { status: 'verified' } } } });
const clerk = {
  session: resumed ? session : organizationFocus ? pendingOrganization : null as Session | null,
  addListener: (listener: (state: { session: Session }) => void) => {
    if (finalizationRecovery || organizationFocus || authContext) {
      listeners.add(listener);
    }
    return () => listeners.delete(listener);
  },
  setActive: (options: { session: string; organization?: string; navigate: Navigate }) => {
    count('activation');
    activationKeys = Object.keys(options).sort();
    activationSession = options.session;
    if (organizationFocus) {
      // Simulated successful SDK activation; real SDK focus behavior has its own fixture.
      organizationState.activationSession = options.session;
      organizationState.activationOrganization = options.organization ?? null;
      saveOrganizationState();
      clerk.session = { ...session, lastActiveOrganizationId: options.organization ?? session.lastActiveOrganizationId };
      listeners.forEach(listener => listener({ session: clerk.session! }));
      options.navigate({ session: clerk.session, decorateUrl });
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      finishActivation = () => {
        options.navigate({ session, decorateUrl });
        options.navigate({ session, decorateUrl });
        resolve();
      };
    });
  },
  signOut: async (options?: { redirectUrl?: string }) => {
    if (new URLSearchParams(location.search).has('signOutFailure')) {
      throw new Error('Fixture sign-out unavailable');
    }
    document.body.dataset.signedOut = options?.redirectUrl ?? 'yes';
  },
};
if (organizationFocus) {
  // Controlled document focus makes the application branch deterministic in both engines.
  // This is an application fixture, not a claim about actual Safari focus/provider timing.
  let focused = false;
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
  Object.assign(window, {
    organizationFocusFixture: {
      inspect: () => ({ ...organizationState, ...counts, currentSessionId: clerk.session?.id }),
      focus: () => {
        focused = true;
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      },
      replaceSession: () => {
        clerk.session = { ...session, id: 'fixture-replacement-session' };
        listeners.forEach(listener => listener({ session: clerk.session! }));
      },
    },
  });
}
export const useClerk = () => clerk;
export const useSignIn = () => ({
  isLoaded: true,
  signIn: finalizationRecovery || authContext
    ? { create: async () => {
        throw Object.assign(new Error('Synthetic identifier not found'), { errors: [{ code: 'form_identifier_not_found' }] });
      } }
    : null,
});
const signUp = {
  createdSessionId: null as string | null,
  finalize: async (options?: { navigate: Navigate }) => {
    if (authContext) {
      // Simulated account completion; SDK option persistence is verified separately.
      count('finalize');
      clerk.session = session;
      listeners.forEach(listener => listener({ session }));
      options?.navigate({ session, decorateUrl });
      return { error: null };
    }
    if (!finalizationRecovery) {
      return { error: null };
    }
    count('finalize');
    finalizeNavigate = options?.navigate;
    clerk.session = session;
    listeners.forEach(listener => listener({ session }));
    await new Promise<void>((resolve) => {
      finishFinalize = resolve;
    });
    return { error: null };
  },
  password: async () => {
    if (finalizationRecovery || authContext) {
      count('password');
      signUp.createdSessionId = session.id;
      signUp.status = 'complete';
    }
    return { error: null };
  },
  sso: async () => ({ error: null }),
  status: null as string | null,
  verifications: {
    emailAddress: { status: 'unverified' },
    sendEmailCode: async () => ({ error: null }),
    verifyEmailCode: async () => ({ error: null }),
  },
};
if (finalizationRecovery) {
  // Test-only controls never touch a real Clerk client or backend.
  Object.assign(window, {
    accountRecoveryFixture: {
      counts: () => ({ ...counts, activationKeys, activationSession, currentSessionId: clerk.session?.id, currentOrganizationId: clerk.session?.lastActiveOrganizationId }),
      settleFinalize: () => finishFinalize?.(),
      completeActivation: () => finishActivation?.(),
      replaceSession: () => {
        clerk.session = { ...session, id: 'fixture-replacement-session' };
        listeners.forEach(listener => listener({ session: clerk.session! }));
      },
      invokeStaleNavigate: () => finalizeNavigate?.({ session, decorateUrl }),
    },
  });
}
export const useSignUp = () => ({ signUp });
export const HandleSSOCallback = () => null;
