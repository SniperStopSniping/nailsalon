import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  ADMIN_SESSION_COOKIE,
  COOKIE_OPTIONS,
  formatPhoneE164,
} from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import {
  constantTimeSecretEqual,
  getDeploymentEnvironment,
  getSuperAdminPasswordConfig,
} from '@/libs/authConfig.server';
import { db } from '@/libs/DB';
import { getClientIp } from '@/libs/rateLimit';
import {
  beginSuperAdminLoginAttempt,
  clearSuperAdminLoginFailures,
  recordSuperAdminLoginFailure,
} from '@/libs/superAdminPasswordRateLimit';
import { adminSessionSchema, adminUserSchema } from '@/models/Schema';

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const INVALID_CREDENTIALS = { error: 'Invalid credentials' } as const;

function failure(status: number, retryAfterSeconds?: number) {
  const headers = retryAfterSeconds
    ? { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) }
    : undefined;
  return NextResponse.json(INVALID_CREDENTIALS, { status, headers });
}

async function auditFailure(outcome: 'failure' | 'locked' | 'unavailable') {
  await logAuditEvent({
    actorType: 'system',
    action: 'super_admin_password_login_failed',
    metadata: {
      environment: getDeploymentEnvironment(),
      outcome,
    },
  });
}

export async function POST(request: Request) {
  const config = getSuperAdminPasswordConfig();
  const configuredAccount = config.phone ?? 'unconfigured-super-admin';
  const ip = getClientIp(request);

  try {
    const limit = await beginSuperAdminLoginAttempt(ip, configuredAccount);
    if (!limit.allowed) {
      await auditFailure('locked');
      return failure(429, limit.retryAfterSeconds);
    }
  } catch {
    await auditFailure('unavailable');
    return failure(503);
  }

  let submittedPhone = '';
  let submittedPassword = '';
  try {
    const body = await request.json() as { phone?: unknown; password?: unknown };
    submittedPassword = typeof body.password === 'string' ? body.password : '';
    submittedPhone = typeof body.phone === 'string'
      ? formatPhoneE164(body.phone)
      : '';
  } catch {
    // Use empty values so malformed requests follow the same comparison path.
  }

  const expectedPhone = config.phone ?? 'invalid-configured-phone';
  const expectedPassword = config.password ?? 'invalid-configured-password';
  const phoneMatches = constantTimeSecretEqual(submittedPhone, expectedPhone);
  const passwordMatches = constantTimeSecretEqual(submittedPassword, expectedPassword);

  let admin: { id: string; isSuperAdmin: boolean } | null = null;
  try {
    if (config.enabled && phoneMatches && passwordMatches && config.phone) {
      const [existing] = await db
        .select({
          id: adminUserSchema.id,
          isSuperAdmin: adminUserSchema.isSuperAdmin,
        })
        .from(adminUserSchema)
        .where(
          and(
            eq(adminUserSchema.phoneE164, config.phone),
            eq(adminUserSchema.isSuperAdmin, true),
          ),
        )
        .limit(1);
      admin = existing?.isSuperAdmin === true ? existing : null;
    }
  } catch {
    await auditFailure('failure');
    return failure(401);
  }

  if (!admin) {
    try {
      const lock = await recordSuperAdminLoginFailure(configuredAccount);
      await auditFailure(lock.locked ? 'locked' : 'failure');
      return failure(lock.locked ? 429 : 401, lock.retryAfterSeconds);
    } catch {
      await auditFailure('unavailable');
      return failure(503);
    }
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  try {
    await db.insert(adminSessionSchema).values({
      id: sessionId,
      adminId: admin.id,
      expiresAt,
    });
  } catch {
    await auditFailure('failure');
    return failure(401);
  }

  try {
    await clearSuperAdminLoginFailures(configuredAccount);
  } catch {
    await db.delete(adminSessionSchema).where(eq(adminSessionSchema.id, sessionId));
    await auditFailure('unavailable');
    return failure(503);
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, sessionId, {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_DURATION_MS / 1000,
    expires: expiresAt,
  });

  await logAuditEvent({
    actorType: 'super_admin',
    actorId: admin.id,
    action: 'super_admin_password_login_succeeded',
    metadata: { environment: getDeploymentEnvironment() },
  });

  return NextResponse.json({ success: true, destination: 'SUPER_ADMIN' });
}
