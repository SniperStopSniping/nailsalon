// Isolated browser adapter. No Clerk account is created or contacted.
export const useAuth = () => ({ isLoaded: true, isSignedIn: true, userId: 'fixture-owner', getToken: async () => 'fixture-token' });
export const useUser = () => ({ isLoaded: true, user: { id: 'fixture-owner', primaryEmailAddress: { emailAddress: 'owner@example.test', verification: { status: 'verified' } } } });
const clerk = {
  addListener: () => () => {},
  signOut: async (options?: { redirectUrl?: string }) => {
    if (new URLSearchParams(location.search).has('signOutFailure')) {
      throw new Error('Fixture sign-out unavailable');
    }
    document.body.dataset.signedOut = options?.redirectUrl ?? 'yes';
  },
};
export const useClerk = () => clerk;
export const useSignIn = () => ({ isLoaded: true, signIn: null });
const signUp = {
  finalize: async () => ({ error: null }),
  password: async () => ({ error: null }),
  sso: async () => ({ error: null }),
  status: null,
  verifications: {
    emailAddress: { status: 'unverified' },
    sendEmailCode: async () => ({ error: null }),
    verifyEmailCode: async () => ({ error: null }),
  },
};
export const useSignUp = () => ({ signUp });
export const HandleSSOCallback = () => null;
