import type { ReactNode } from 'react';

/**
 * Browser-component harness Clerk double.
 *
 * These Vite fixtures test UI against mocked HTTP only. Aliasing Clerk here
 * prevents its Next App Router runtime from entering the browser bundle and
 * guarantees that no identity-provider call can be made by a fixture.
 */
export function useClerk() {
  return {
    openUserProfile() {},
  };
}

export function useAuth() {
  return { isLoaded: true, userId: null, getToken: async () => null };
}

export function useUser() {
  return { isLoaded: true, user: null };
}

export function ClerkProvider({ children }: { children?: ReactNode }) {
  return children ?? null;
}

export function SignIn() {
  return null;
}
export function SignUp() {
  return null;
}
export function SignOutButton({ children }: { children?: ReactNode }) {
  return children ?? null;
}
export function UserButton() {
  return null;
}
export function OrganizationSwitcher() {
  return null;
}
export function OrganizationList() {
  return null;
}
