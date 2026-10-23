// Isolated browser adapter. No Clerk account is created or contacted.
const params = new URLSearchParams(location.search);
const finalizationRecovery = params.get('scenario') === 'finalization-recovery';
const resumed = finalizationRecovery && params.has('claim');
type Session = { id: string; status: string; currentTask: null; lastActiveOrganizationId: string };
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
const decorateUrl = (url: string) => `${url}&scenario=finalization-recovery&fixtureDecorated=1`;
export const useAuth = () => ({ isLoaded: true, isSignedIn: !finalizationRecovery || resumed, userId: 'fixture-owner', getToken: async () => 'fixture-token' });
export const useUser = () => ({ isLoaded: true, user: { id: 'fixture-owner', primaryEmailAddress: { emailAddress: 'owner@example.test', verification: { status: 'verified' } } } });
const clerk = {
  session: resumed ? session : null as Session | null,
  addListener: (listener: (state: { session: Session }) => void) => {
    if (finalizationRecovery) {
      listeners.add(listener);
    }
    return () => listeners.delete(listener);
  },
  setActive: (options: { session: string; navigate: Navigate }) => {
    count('activation');
    activationKeys = Object.keys(options).sort();
    activationSession = options.session;
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
export const useClerk = () => clerk;
export const useSignIn = () => ({
  isLoaded: true,
  signIn: finalizationRecovery
    ? { create: async () => {
        throw Object.assign(new Error('Synthetic identifier not found'), { errors: [{ code: 'form_identifier_not_found' }] });
      } }
    : null,
});
const signUp = {
  createdSessionId: null as string | null,
  finalize: async (options?: { navigate: Navigate }) => {
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
    if (finalizationRecovery) {
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
