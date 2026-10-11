export * from '../clerk';

// Stable hooks match the SDK contract; no identity provider is contacted.
const auth = { isLoaded: true, isSignedIn: false, sessionId: null, userId: null, getToken: async () => null };
const clerk = { openUserProfile() {} };
export const useAuth = () => auth;
export const useClerk = () => clerk;
