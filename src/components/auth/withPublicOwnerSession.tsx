import 'server-only';

import { ClerkProvider } from '@clerk/nextjs';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { ADMIN_SESSION_COOKIE } from '@/libs/adminSessionCookie';
import { hasClerkSessionCookie } from '@/libs/clerkSessionCookie';

/**
 * Public layouts normally omit Clerk. An owner browsing a private preview
 * needs its frontend SDK to renew the short-lived session token between
 * requests, just as it does in the dashboard. Cookie presence only enables
 * renewal; each page still verifies identity and salon access on the server.
 * Legacy sessions retain precedence and anonymous booking stays SDK-free.
 */
export async function withPublicOwnerSession(children: ReactNode) {
  const cookieStore = await cookies();
  if (cookieStore.get(ADMIN_SESSION_COOKIE)?.value
    || !hasClerkSessionCookie(cookieStore.getAll())) {
    return children;
  }

  return <ClerkProvider>{children}</ClerkProvider>;
}
