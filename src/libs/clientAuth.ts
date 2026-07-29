import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { db } from '@/libs/DB';
import { clientSessionSchema } from '@/models/Schema';

export const CLIENT_SESSION_COOKIE = 'client_session';
export const LEGACY_CUSTOMER_AUTH_DISABLED_CODE = 'LEGACY_CUSTOMER_AUTH_DISABLED';
export const LEGACY_CUSTOMER_AUTH_DISABLED_MESSAGE
  = 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.';

const shouldUseSecureCookies = process.env.NODE_ENV === 'production'
  && !(process.env.CI === 'true' && process.env.E2E_INSECURE_COOKIES === 'true');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: shouldUseSecureCookies,
  sameSite: 'lax' as const,
  path: '/',
};

export type ClientSessionPrincipal = {
  phone: string;
  clientName: string | null;
  clientEmail: string | null;
  sessionId: string;
};

export function legacyCustomerAuthDisabledResponse(): Response {
  return Response.json(
    {
      error: {
        code: LEGACY_CUSTOMER_AUTH_DISABLED_CODE,
        message: LEGACY_CUSTOMER_AUTH_DISABLED_MESSAGE,
      },
    },
    { status: 410 },
  );
}

function legacyCustomerAuthDisabledError(): Error & { code: string } {
  return Object.assign(
    new Error(LEGACY_CUSTOMER_AUTH_DISABLED_MESSAGE),
    { code: LEGACY_CUSTOMER_AUTH_DISABLED_CODE },
  );
}

export async function assertClientSessionStorageReady(): Promise<never> {
  throw legacyCustomerAuthDisabledError();
}

export async function createClientSession(_phone: string): Promise<never> {
  throw legacyCustomerAuthDisabledError();
}

/**
 * Client PR 0A security floor.
 *
 * Legacy customer sessions are never authoritative, regardless of cookie
 * contents, database rows, or deployment flags. Keep this denial in place
 * until a tenant-bound customer account system replaces it.
 */
export async function getClientSession(): Promise<ClientSessionPrincipal | null> {
  return null;
}

export async function refreshClientSession(_sessionId: string): Promise<never> {
  throw legacyCustomerAuthDisabledError();
}

export async function deleteClientSession(sessionId: string): Promise<void> {
  await db.delete(clientSessionSchema).where(eq(clientSessionSchema.id, sessionId));
}

export async function setClientSessionCookies(args: {
  phone: string;
  sessionId: string;
  clientName?: string | null;
}): Promise<never> {
  void args;
  throw legacyCustomerAuthDisabledError();
}

export async function clearClientSessionCookies(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(CLIENT_SESSION_COOKIE, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });

  cookieStore.set('client_phone', '', {
    httpOnly: false,
    secure: shouldUseSecureCookies,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  cookieStore.set('client_name', '', {
    httpOnly: false,
    secure: shouldUseSecureCookies,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  cookieStore.set('client_email', '', {
    httpOnly: false,
    secure: shouldUseSecureCookies,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}
