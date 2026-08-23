/**
 * Owner preview authorization matrix (Luster UI/UX plan rev 3, PR 3).
 *
 * Real PGlite-backed integration tests, following the exact pattern in
 * src/libs/bookingQuote.addOnGating.test.ts: PGlite + drizzle + migrate, with
 * only the DB module and `next/headers` cookies mocked. This is deliberately
 * NOT a fully-mocked-db test (unlike src/libs/adminAuth.impersonation.test.ts)
 * — this gate is security sensitive (plan engineering risk 5: "a mistake
 * publishes drafts to the world"), so the matrix runs against real rows and
 * real signed impersonation cookies rather than stubbed query results.
 *
 * Covers all five actors from the PR3 spec, for BOTH scenarios named there:
 * draft-salon rendering (resolveDraftSalonAccess against an unpublished
 * salon) and draft-config-on-a-published-salon (same call against a
 * published salon, asserting on `isPreviewingDraftConfig`).
 *   1. Anonymous — no session at all.
 *   2. Wrong owner — an authenticated owner of a *different* salon.
 *   3. Correct owner — the authenticated owner of this salon.
 *   4. Authorized impersonating super admin.
 *   5. Expired / revoked owner session.
 * Plus a direct cross-tenant check: a super admin impersonating a different
 * salon must not incidentally unlock this one.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const clerkAuth = vi.hoisted(() => vi.fn());

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: clerkAuth,
}));

// Dev-mode role override must be inert in tests — mirrors the mock already
// used in src/libs/adminAuth.impersonation.test.ts — so resolution always
// exercises the real cookie/session/impersonation path below, never the
// dev-only shortcut in getAdminSession().
vi.mock('@/libs/devRole.server', () => ({
  isDevModeServer: () => false,
  readDevRoleFromCookies: () => null,
  getMockAdminSession: () => {
    throw new Error('getMockAdminSession should not be reachable in this test');
  },
}));

const cookieJar = vi.hoisted(() => new Map<string, { value: string }>());

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => {
      cookieJar.set(name, { value });
    },
  }),
}));

function setCookie(name: string, value: string) {
  cookieJar.set(name, { value });
}

function clearCookies() {
  cookieJar.clear();
}

/* eslint-disable import/first */
import { ADMIN_SESSION_COOKIE } from '@/libs/adminAuth';
import {
  IMPERSONATE_COOKIE,
  serializeAdminImpersonationSession,
} from '@/libs/adminImpersonation';

import { resolveDraftSalonAccess, resolveOwnerPreviewContext } from './ownerPreview';
/* eslint-enable import/first */

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

const SALON_ID = 'salon_preview_target';
const OTHER_SALON_ID = 'salon_preview_other';

const OWNER_ADMIN_ID = 'admin_preview_owner';
const OTHER_OWNER_ADMIN_ID = 'admin_preview_other_owner';
const SUPER_ADMIN_ID = 'admin_preview_super';
const OWNER_CLERK_ID = 'user_preview_owner';
const OTHER_OWNER_CLERK_ID = 'user_preview_other_owner';

const OWNER_SESSION_ID = 'session_preview_owner_valid';
const OTHER_OWNER_SESSION_ID = 'session_preview_other_owner_valid';
const SUPER_ADMIN_SESSION_ID = 'session_preview_super_valid';
const EXPIRED_OWNER_SESSION_ID = 'session_preview_owner_expired';
// Deliberately never inserted into admin_session — simulates a revoked
// session (e.g. after deleteAdminSession) via a cookie pointing at nothing.
const REVOKED_SESSION_ID = 'session_preview_owner_revoked_does_not_exist';

const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z');
const PAST = new Date('2020-01-01T00:00:00.000Z');

function draftSalon() {
  return { id: SALON_ID, publicationStatus: 'draft', freeSoloEnabled: true };
}

function publishedSalon() {
  return { id: SALON_ID, publicationStatus: 'published', freeSoloEnabled: true };
}

function impersonationCookieFor(salonId: string, salonSlug: string, adminId: string) {
  return serializeAdminImpersonationSession({
    salonId,
    salonSlug,
    salonName: 'Impersonated Salon',
    adminUserId: adminId,
    adminName: 'Sam Super',
    startedAt: new Date().toISOString(),
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Target Salon', slug: 'target-salon', settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'other-salon', settings: {} },
  ]);

  await db.insert(schema.adminUserSchema).values([
    { id: OWNER_ADMIN_ID, phoneE164: '+15550000001', name: 'Target Owner', isSuperAdmin: false, clerkUserId: OWNER_CLERK_ID },
    { id: OTHER_OWNER_ADMIN_ID, phoneE164: '+15550000002', name: 'Other Owner', isSuperAdmin: false, clerkUserId: OTHER_OWNER_CLERK_ID },
    { id: SUPER_ADMIN_ID, phoneE164: '+15550000003', name: 'Sam Super', isSuperAdmin: true },
  ]);

  await db.insert(schema.adminSalonMembershipSchema).values([
    { adminId: OWNER_ADMIN_ID, salonId: SALON_ID, role: 'owner' },
    { adminId: OTHER_OWNER_ADMIN_ID, salonId: OTHER_SALON_ID, role: 'owner' },
  ]);

  await db.insert(schema.adminSessionSchema).values([
    { id: OWNER_SESSION_ID, adminId: OWNER_ADMIN_ID, expiresAt: FAR_FUTURE },
    { id: OTHER_OWNER_SESSION_ID, adminId: OTHER_OWNER_ADMIN_ID, expiresAt: FAR_FUTURE },
    { id: SUPER_ADMIN_SESSION_ID, adminId: SUPER_ADMIN_ID, expiresAt: FAR_FUTURE },
    { id: EXPIRED_OWNER_SESSION_ID, adminId: OWNER_ADMIN_ID, expiresAt: PAST },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('resolveOwnerPreviewContext — authorization matrix', () => {
  beforeEach(() => {
    clearCookies();
    clerkAuth.mockReset();
    clerkAuth.mockResolvedValue({ userId: null });
  });

  it('1. anonymous (no session) fails closed', async () => {
    const result = await resolveOwnerPreviewContext(SALON_ID);

    expect(result).toEqual({ isPreviewing: false, actorType: null, reason: 'no_session' });
  });

  it('2. wrong owner (authenticated owner of a different salon) fails closed', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OTHER_OWNER_SESSION_ID);
    const result = await resolveOwnerPreviewContext(SALON_ID);

    expect(result).toEqual({ isPreviewing: false, actorType: null, reason: 'wrong_owner' });
  });

  it('3. correct owner succeeds', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OWNER_SESSION_ID);
    const result = await resolveOwnerPreviewContext(SALON_ID);

    expect(result).toEqual({ isPreviewing: true, actorType: 'owner', reason: 'owner_match' });
  });

  it('4. authorized impersonating super admin succeeds', async () => {
    setCookie(ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_ID);
    setCookie(IMPERSONATE_COOKIE, impersonationCookieFor(SALON_ID, 'target-salon', SUPER_ADMIN_ID));
    const result = await resolveOwnerPreviewContext(SALON_ID);

    expect(result).toEqual({ isPreviewing: true, actorType: 'super_admin', reason: 'impersonation_match' });
  });

  it('4b. super admin session with NO active impersonation fails closed (stricter than requireAdmin)', async () => {
    setCookie(ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_ID);
    const result = await resolveOwnerPreviewContext(SALON_ID);

    expect(result).toEqual({ isPreviewing: false, actorType: null, reason: 'super_admin_not_impersonating' });
  });

  it('4c. super admin impersonating a DIFFERENT salon fails closed for this salon (cross-tenant guard)', async () => {
    setCookie(ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_ID);
    setCookie(IMPERSONATE_COOKIE, impersonationCookieFor(OTHER_SALON_ID, 'other-salon', SUPER_ADMIN_ID));
    const result = await resolveOwnerPreviewContext(SALON_ID);

    expect(result).toEqual({ isPreviewing: false, actorType: null, reason: 'impersonation_wrong_salon' });
  });

  it('5a. expired owner session fails closed', async () => {
    setCookie(ADMIN_SESSION_COOKIE, EXPIRED_OWNER_SESSION_ID);
    const result = await resolveOwnerPreviewContext(SALON_ID);

    expect(result).toEqual({ isPreviewing: false, actorType: null, reason: 'no_session' });
  });

  it('5b. revoked (deleted) owner session fails closed', async () => {
    setCookie(ADMIN_SESSION_COOKIE, REVOKED_SESSION_ID);
    const result = await resolveOwnerPreviewContext(SALON_ID);

    expect(result).toEqual({ isPreviewing: false, actorType: null, reason: 'no_session' });
  });

  it('fails closed with no salon id, before touching any session state', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OWNER_SESSION_ID);
    const result = await resolveOwnerPreviewContext('');

    expect(result).toEqual({ isPreviewing: false, actorType: null, reason: 'no_salon_id' });
  });
});

describe('resolveOwnerPreviewContext — Production Clerk-only Owner path', () => {
  beforeEach(() => {
    clearCookies();
    setCookie('__session', 'opaque-clerk-session-cookie');
    clerkAuth.mockReset();
  });

  it('authorizes the linked owner with no legacy admin cookie', async () => {
    clerkAuth.mockResolvedValue({ userId: OWNER_CLERK_ID });

    await expect(resolveOwnerPreviewContext(SALON_ID)).resolves.toEqual({
      isPreviewing: true,
      actorType: 'owner',
      reason: 'owner_match',
    });
    expect(cookieJar.has(ADMIN_SESSION_COOKIE)).toBe(false);
  });

  it('denies a Clerk owner linked only to another salon', async () => {
    clerkAuth.mockResolvedValue({ userId: OTHER_OWNER_CLERK_ID });

    await expect(resolveOwnerPreviewContext(SALON_ID)).resolves.toEqual({
      isPreviewing: false,
      actorType: null,
      reason: 'wrong_owner',
    });
  });

  it('fails closed when the Clerk session is missing, expired, or revoked', async () => {
    clerkAuth.mockResolvedValueOnce({ userId: OWNER_CLERK_ID });

    await expect(resolveOwnerPreviewContext(SALON_ID)).resolves.toMatchObject({
      isPreviewing: true,
    });

    clerkAuth.mockResolvedValue({ userId: null });

    await expect(resolveOwnerPreviewContext(SALON_ID)).resolves.toEqual({
      isPreviewing: false,
      actorType: null,
      reason: 'no_session',
    });
  });

  it('fails closed when Clerk middleware context is absent or throws', async () => {
    clerkAuth.mockRejectedValue(new Error('Clerk auth() was called without middleware context'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(resolveOwnerPreviewContext(SALON_ID)).resolves.toEqual({
      isPreviewing: false,
      actorType: null,
      reason: 'no_session',
    });

    consoleError.mockRestore();
  });
});

describe('resolveDraftSalonAccess — draft salon rendering (the 404 gate)', () => {
  beforeEach(() => {
    clearCookies();
    clerkAuth.mockReset();
    clerkAuth.mockResolvedValue({ userId: null });
  });

  it('1. anonymous gets 404 (not allowed)', async () => {
    const result = await resolveDraftSalonAccess(draftSalon());

    expect(result).toEqual({ allowed: false, reason: 'no_session' });
  });

  it('2. wrong owner gets 404 (not allowed)', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OTHER_OWNER_SESSION_ID);
    const result = await resolveDraftSalonAccess(draftSalon());

    expect(result).toEqual({ allowed: false, reason: 'wrong_owner' });
  });

  it('3. correct owner bypasses the 404', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OWNER_SESSION_ID);
    const result = await resolveDraftSalonAccess(draftSalon());

    expect(result).toEqual({
      allowed: true,
      isPreviewingDraftSalon: true,
      isPreviewingDraftConfig: true,
      actorType: 'owner',
    });
  });

  it('4. authorized impersonating super admin bypasses the 404', async () => {
    setCookie(ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_ID);
    setCookie(IMPERSONATE_COOKIE, impersonationCookieFor(SALON_ID, 'target-salon', SUPER_ADMIN_ID));
    const result = await resolveDraftSalonAccess(draftSalon());

    expect(result).toEqual({
      allowed: true,
      isPreviewingDraftSalon: true,
      isPreviewingDraftConfig: true,
      actorType: 'super_admin',
    });
  });

  it('5. expired/revoked owner session gets 404 (not allowed)', async () => {
    setCookie(ADMIN_SESSION_COOKIE, EXPIRED_OWNER_SESSION_ID);
    const result = await resolveDraftSalonAccess(draftSalon());

    expect(result).toEqual({ allowed: false, reason: 'no_session' });
  });
});

describe('resolveDraftSalonAccess — draft config on an otherwise-published salon', () => {
  beforeEach(() => {
    clearCookies();
    clerkAuth.mockReset();
    clerkAuth.mockResolvedValue({ userId: null });
  });

  it('1. anonymous still renders the page, on the LIVE config', async () => {
    const result = await resolveDraftSalonAccess(publishedSalon());

    expect(result).toEqual({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: false,
      actorType: null,
    });
  });

  it('2. wrong owner still renders the page, on the LIVE config', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OTHER_OWNER_SESSION_ID);
    const result = await resolveDraftSalonAccess(publishedSalon());

    expect(result).toEqual({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: false,
      actorType: null,
    });
  });

  it('3. correct owner sees the DRAFT config', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OWNER_SESSION_ID);
    const result = await resolveDraftSalonAccess(publishedSalon());

    expect(result).toEqual({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: true,
      actorType: 'owner',
    });
  });

  it('4. authorized impersonating super admin sees the DRAFT config', async () => {
    setCookie(ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_ID);
    setCookie(IMPERSONATE_COOKIE, impersonationCookieFor(SALON_ID, 'target-salon', SUPER_ADMIN_ID));
    const result = await resolveDraftSalonAccess(publishedSalon());

    expect(result).toEqual({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: true,
      actorType: 'super_admin',
    });
  });

  it('5. expired/revoked owner session sees the LIVE config, not draft', async () => {
    setCookie(ADMIN_SESSION_COOKIE, REVOKED_SESSION_ID);
    const result = await resolveDraftSalonAccess(publishedSalon());

    expect(result).toEqual({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: false,
      actorType: null,
    });
  });
});
