import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';
import { z } from 'zod';

import { ACTIVE_SALON_COOKIE } from './tenantSlug';

export const IMPERSONATE_COOKIE = 'sa_impersonate';
export const IMPERSONATION_MAX_AGE_SECONDS = 60 * 60 * 2;

const impersonationSchema = z.object({
  salonId: z.string().min(1),
  salonSlug: z.string().min(1),
  salonName: z.string().min(1),
  adminUserId: z.string().min(1),
  adminPhone: z.string().min(1),
  startedAt: z.string().datetime(),
});

export type AdminImpersonationSession = z.infer<typeof impersonationSchema>;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

function getSigningSecret(): string {
  return process.env.SUPER_ADMIN_IMPERSONATION_SECRET
    || process.env.CLERK_SECRET_KEY
    || process.env.DATABASE_URL
    || 'dev-only-impersonation-secret';
}

function signPayload(payload: string): string {
  return createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
}

function signaturesMatch(signature: string, expected: string): boolean {
  const given = Buffer.from(signature);
  const target = Buffer.from(expected);

  return given.length === target.length && timingSafeEqual(given, target);
}

export function serializeAdminImpersonationSession(
  session: AdminImpersonationSession,
): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${signPayload(payload)}`;
}

export function parseAdminImpersonationSession(
  value: string,
): AdminImpersonationSession | null {
  const [payload, signature] = value.split('.');

  if (!payload || !signature) {
    return null;
  }

  if (!signaturesMatch(signature, signPayload(payload))) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const parsed = impersonationSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getAdminImpersonationSession(): Promise<AdminImpersonationSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(IMPERSONATE_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  return parseAdminImpersonationSession(raw);
}

export async function setAdminImpersonationSession(
  session: AdminImpersonationSession,
): Promise<void> {
  const cookieStore = await cookies();
  const serialized = serializeAdminImpersonationSession(session);

  cookieStore.set(IMPERSONATE_COOKIE, serialized, {
    ...COOKIE_OPTIONS,
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
  });

  cookieStore.set(ACTIVE_SALON_COOKIE, session.salonSlug, {
    ...COOKIE_OPTIONS,
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
  });
}

export async function clearAdminImpersonationSession(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(IMPERSONATE_COOKIE, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });

  cookieStore.set(ACTIVE_SALON_COOKIE, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
}
