import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { db } from '@/libs/DB';
import { getClientByPhone } from '@/libs/queries';
import { clientSessionSchema } from '@/models/Schema';

export const CLIENT_SESSION_COOKIE = 'client_session';
export const CLIENT_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

function formatPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  throw new Error('Invalid phone number format');
}

export type ClientSessionPrincipal = {
  phone: string;
  clientName: string | null;
  clientEmail: string | null;
  sessionId: string;
};

export async function assertClientSessionStorageReady(): Promise<void> {
  await db
    .select({ id: clientSessionSchema.id })
    .from(clientSessionSchema)
    .limit(1);
}

export async function createClientSession(phone: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CLIENT_SESSION_DURATION_MS);

  await db.insert(clientSessionSchema).values({
    id: sessionId,
    clientPhone: formatPhoneE164(phone),
    expiresAt,
  });

  return sessionId;
}

export async function getClientSession(): Promise<ClientSessionPrincipal | null> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;

    if (!sessionId) {
      return null;
    }

    const [session] = await db
      .select()
      .from(clientSessionSchema)
      .where(
        and(
          eq(clientSessionSchema.id, sessionId),
          gt(clientSessionSchema.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      return null;
    }

    const client = await getClientByPhone(session.clientPhone);

    db.update(clientSessionSchema)
      .set({ lastSeenAt: new Date() })
      .where(eq(clientSessionSchema.id, sessionId))
      .catch(() => {});

    return {
      phone: session.clientPhone,
      clientName: client?.firstName ?? null,
      clientEmail: client?.email ?? null,
      sessionId,
    };
  } catch (error) {
    console.error('Error getting client session:', error);
    return null;
  }
}

export async function refreshClientSession(sessionId: string): Promise<void> {
  await db
    .update(clientSessionSchema)
    .set({
      expiresAt: new Date(Date.now() + CLIENT_SESSION_DURATION_MS),
      lastSeenAt: new Date(),
    })
    .where(eq(clientSessionSchema.id, sessionId));
}

export async function deleteClientSession(sessionId: string): Promise<void> {
  await db.delete(clientSessionSchema).where(eq(clientSessionSchema.id, sessionId));
}

export async function setClientSessionCookies(args: {
  phone: string;
  sessionId: string;
  clientName?: string | null;
}): Promise<void> {
  const { sessionId } = args;
  const cookieStore = await cookies();

  cookieStore.set(CLIENT_SESSION_COOKIE, sessionId, {
    ...COOKIE_OPTIONS,
    maxAge: CLIENT_SESSION_DURATION_MS / 1000,
  });

  for (const legacyCookie of ['client_phone', 'client_name', 'client_email']) {
    cookieStore.set(legacyCookie, '', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });
  }
}

export async function clearClientSessionCookies(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(CLIENT_SESSION_COOKIE, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });

  cookieStore.set('client_phone', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  cookieStore.set('client_name', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  cookieStore.set('client_email', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}
