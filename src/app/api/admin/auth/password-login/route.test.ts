/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  audit,
  beginAttempt,
  clearFailures,
  cookieSet,
  db,
  insertValues,
  recordFailure,
  selectLimit,
} = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectQuery = {
    from: vi.fn(() => selectQuery),
    where: vi.fn(() => selectQuery),
    limit: selectLimit,
  };
  const insertValues = vi.fn(async (_values: Record<string, unknown>) => undefined);
  const deleteWhere = vi.fn(async () => undefined);
  return {
    audit: vi.fn(async () => undefined),
    beginAttempt: vi.fn(),
    clearFailures: vi.fn(async () => undefined),
    cookieSet: vi.fn(),
    db: {
      select: vi.fn(() => selectQuery),
      insert: vi.fn(() => ({ values: insertValues })),
      delete: vi.fn(() => ({ where: deleteWhere })),
    },
    deleteWhere,
    insertValues,
    recordFailure: vi.fn(),
    selectLimit,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ set: cookieSet })) }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: audit }));
vi.mock('@/libs/adminAuth', () => ({
  ADMIN_SESSION_COOKIE: 'n5_admin_session',
  COOKIE_OPTIONS: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
  formatPhoneE164: (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    throw new Error('invalid phone');
  },
}));
vi.mock('@/libs/superAdminPasswordRateLimit', () => ({
  beginSuperAdminLoginAttempt: beginAttempt,
  clearSuperAdminLoginFailures: clearFailures,
  recordSuperAdminLoginFailure: recordFailure,
}));

import { POST } from './route';

const originalEnv = { ...process.env };
const fetchSpy = vi.spyOn(globalThis, 'fetch');
const fakePhone = '+14165550123';
const fakePassword = 'fake-test-passcode';
const admin = {
  id: 'admin_super_1',
  phoneE164: fakePhone,
  clerkUserId: null,
  name: 'Test Super',
  email: 'super@example.test',
  emailVerifiedAt: null,
  isSuperAdmin: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function request(phone = fakePhone, password = fakePassword) {
  return new Request('https://preview.example.test/api/admin/auth/password-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.5' },
    body: JSON.stringify({ phone, password }),
  });
}

describe('POST /api/admin/auth/password-login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    process.env.SUPER_ADMIN_AUTH_MODE = 'password';
    process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED = 'true';
    process.env.SUPER_ADMIN_TEST_PHONE = fakePhone;
    process.env.SUPER_ADMIN_TEST_PASSWORD = fakePassword;
    delete process.env.VERCEL_ENV;
    delete process.env.APP_ENV;
    beginAttempt.mockResolvedValue({ allowed: true });
    recordFailure.mockResolvedValue({ locked: false });
    selectLimit.mockResolvedValue([admin]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('creates an eight-hour HttpOnly database session for the exact existing super admin', async () => {
    const before = Date.now();
    const response = await POST(request('416-555-0123', fakePassword));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, destination: 'SUPER_ADMIN' });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ adminId: admin.id }));

    const inserted = insertValues.mock.calls[0]?.[0] as { id: string; expiresAt: Date } | undefined;

    expect(inserted).toBeDefined();

    if (!inserted) {
      throw new Error('Expected a database session insert');
    }

    expect(inserted.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 8 * 60 * 60 * 1000);
    expect(cookieSet).toHaveBeenCalledWith('n5_admin_session', inserted.id, expect.objectContaining({
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60,
    }));
    expect(clearFailures).toHaveBeenCalledWith(fakePhone);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts login when SUPER_ADMIN_TEST_PHONE is configured without the +1 prefix', async () => {
    // Regression: a configured phone stored as bare digits used to fail both the
    // constant-time compare and the phone_e164 lookup because only the submitted
    // phone was normalized. It must now succeed on equal footing.
    process.env.SUPER_ADMIN_TEST_PHONE = '4165550123';
    const response = await POST(request('+14165550123', fakePassword));

    expect(response.status).toBe(200);
    // Compare, DB lookup, and rate-limit account key all key off the normalized phone.
    expect(clearFailures).toHaveBeenCalledWith(fakePhone);
  });

  it('accepts login when SUPER_ADMIN_TEST_PHONE is configured as 11 digits without a plus', async () => {
    process.env.SUPER_ADMIN_TEST_PHONE = '14165550123';
    const response = await POST(request('416-555-0123', fakePassword));

    expect(response.status).toBe(200);
  });

  it('still rejects a wrong password even when the configured phone lacks the +1 prefix', async () => {
    process.env.SUPER_ADMIN_TEST_PHONE = '4165550123';
    const response = await POST(request('+14165550123', 'wrong-passcode'));

    expect(response.status).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('returns the generic body and Retry-After when the account is locked out', async () => {
    beginAttempt.mockResolvedValue({ allowed: false, reason: 'account_locked', retryAfterSeconds: 1800 });
    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('1800');
    await expect(response.json()).resolves.toEqual({ error: 'Invalid credentials' });
  });

  it.each([
    ['incorrect phone', '+14165550999', fakePassword],
    ['incorrect password', fakePhone, 'wrong-passcode'],
  ])('rejects %s with the same generic response', async (_name, phone, password) => {
    const response = await POST(request(phone, password));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid credentials' });
    expect(db.select).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('rejects a missing database user or non-super-admin without changing it', async () => {
    selectLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...admin, isSuperAdmin: false }]);
    const missing = await POST(request());
    const notSuper = await POST(request());

    expect(missing.status).toBe(401);
    expect(notSuper.status).toBe(401);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('fails generically when server credential configuration is missing', async () => {
    delete process.env.SUPER_ADMIN_TEST_PASSWORD;
    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid credentials' });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns the generic body and Retry-After when an attempt is rate limited', async () => {
    beginAttempt.mockResolvedValue({ allowed: false, reason: 'ip_limit', retryAfterSeconds: 300 });
    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('300');
    await expect(response.json()).resolves.toEqual({ error: 'Invalid credentials' });
  });

  it('accepts configured password login in production and does not call Twilio', async () => {
    process.env = { ...process.env, NODE_ENV: 'production', VERCEL_ENV: 'production' };
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never places credentials in response or audit metadata', async () => {
    const response = await POST(request(fakePhone, 'wrong-passcode'));

    expect(JSON.stringify(await response.json())).not.toContain(fakePhone);

    for (const call of audit.mock.calls) {
      const serialized = JSON.stringify(call);

      expect(serialized).not.toContain(fakePhone);
      expect(serialized).not.toContain(fakePassword);
    }
  });
});
