/**
 * Direct control-flow coverage for `[locale]/[slug]/layout.tsx` (Luster
 * UI/UX plan rev 3, PR 3; engineering risk 5: "the owner-preview bypass
 * touches the public 404 gate, a mistake publishes drafts to the world").
 *
 * Three independent review rounds confirmed `resolveOwnerPreviewContext` /
 * `resolveDraftSalonAccess` (src/libs/ownerPreview.ts) are correct and
 * fail-closed, backed by 26 PGlite integration tests in
 * src/libs/ownerPreview.test.ts. The gap those rounds left open: this
 * layout — the single highest-risk call site the plan names — had zero
 * direct coverage of its own control flow. Nothing would have caught a
 * future edit that inverted `previewGate.allowed`, dropped the `notFound()`
 * call, or swapped which `bookingPage` side gets threaded through.
 *
 * This file exercises the REAL `SlugTenantLayout` export end to end against
 * a real PGlite database (same pattern as ownerPreview.test.ts and
 * src/libs/bookingQuote.addOnGating.test.ts) — only the DB connection,
 * framework request context, Clerk SDK boundary and dev-role override are
 * mocked. `resolveOwnerPreviewContext`
 * / `resolveDraftSalonAccess` and the layout's own conditionals are never
 * mocked, so deleting or inverting the `previewGate.allowed` check (or the
 * bookingPage-side selection below it) makes these tests fail.
 *
 * The layout does NOT render `PreviewBanner` — that duplicated the banner
 * PublicSalonPageShell already renders for every real booking page, because
 * the real `[locale]/[slug]/book/*` routes are re-exports of
 * `(unauth)/book/*` and are physically nested under this layout. This file
 * asserts only on `notFound()`/`ownerPreview` context/`bookingPage` side
 * selection; the one-banner regression is covered end to end, with the real
 * nested page mounted, in `[locale]/[slug]/book/service/page.test.tsx`.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { render, screen } from '@testing-library/react';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="clerk-session-renewal">{children}</div>
  ),
}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

// Dev-mode role override must be inert — mirrors src/libs/ownerPreview.test.ts
// — so every scenario below exercises the real cookie/session/impersonation
// path in resolveOwnerPreviewContext, never the dev-only shortcut.
vi.mock('@/libs/devRole.server', () => ({
  isDevModeServer: () => false,
  readDevRoleFromCookies: () => null,
  getMockAdminSession: () => {
    throw new Error('getMockAdminSession should not be reachable in this test');
  },
}));

const cookieJar = vi.hoisted(() => new Map<string, { value: string }>());
const clerkContext = vi.hoisted(() => ({
  ready: false,
  userId: null as string | null,
  middleware: vi.fn(),
  auth: vi.fn(),
  intl: vi.fn(),
}));

// Compose the actual middleware, layout and database-backed preview gate.
// The SDK boundary models an already-verified identity; it cannot return one
// without the middleware first establishing context. This is not a Clerk
// token-verification or hosted Next.js request-lifecycle test.
vi.mock('next-intl/middleware', () => ({ default: () => clerkContext.intl }));
vi.mock('@clerk/nextjs/server', async importOriginal => ({
  ...await importOriginal<typeof import('@clerk/nextjs/server')>(),
  clerkMiddleware: clerkContext.middleware,
  auth: clerkContext.auth,
  currentUser: () => {
    throw new Error('Unexpected external user lookup');
  },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.get(name),
    getAll: () => [...cookieJar].map(([name, cookie]) => ({ name, value: cookie.value })),
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

const { notFound } = vi.hoisted(() => ({ notFound: vi.fn() }));
const NOT_FOUND_SENTINEL = new Error('layout-test:not-found');

vi.mock('next/navigation', () => ({
  notFound,
  redirect: vi.fn(),
}));

/* eslint-disable import/first */
import { ADMIN_SESSION_COOKIE } from '@/libs/adminAuth';
import {
  IMPERSONATE_COOKIE,
  serializeAdminImpersonationSession,
} from '@/libs/adminImpersonation';
import { useSalon } from '@/providers/SalonProvider';

import middleware from '../../../middleware';
import SlugTenantLayout from './layout';
/* eslint-enable import/first */

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

const DRAFT_SALON_ID = 'salon_layout_draft';
const DRAFT_SALON_SLUG = 'layout-draft-salon';
const PUBLISHED_SALON_ID = 'salon_layout_published';
const PUBLISHED_SALON_SLUG = 'layout-published-salon';
const OTHER_SALON_ID = 'salon_layout_other';
const OTHER_SALON_SLUG = 'layout-other-salon';

const OWNER_ADMIN_ID = 'admin_layout_owner';
const OTHER_OWNER_ADMIN_ID = 'admin_layout_other_owner';
const SUPER_ADMIN_ID = 'admin_layout_super';

const OWNER_SESSION_ID = 'session_layout_owner_valid';
const OTHER_OWNER_SESSION_ID = 'session_layout_other_owner_valid';
const SUPER_ADMIN_SESSION_ID = 'session_layout_super_valid';
const EXPIRED_OWNER_SESSION_ID = 'session_layout_owner_expired';
// Deliberately never inserted into admin_session — simulates a revoked
// session (e.g. after deleteAdminSession) via a cookie pointing at nothing.
const REVOKED_SESSION_ID = 'session_layout_owner_revoked_does_not_exist';

const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z');
const PAST = new Date('2020-01-01T00:00:00.000Z');

// Distinguishable draft vs live layouts so tests can prove which
// `bookingPage` side actually rendered, not just that *a* side rendered.
// `bookingPage` is read generically (as `unknown`) by resolveBookingPageConfig
// and is not yet part of the declared `SalonSettings` type, hence the cast —
// this fixture only needs to round-trip through the real jsonb column.
const PUBLISHED_SALON_SETTINGS = {
  booking: {
    timezone: 'America/Vancouver',
  },
  bookingPage: {
    version: 1,
    live: { layout: 'quick_book' },
    draft: { layout: 'editorial' },
  },
} as unknown as (typeof schema.salonSchema.$inferInsert)['settings'];

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

function ContextProbe() {
  const { bookingPage, bookingTimeZone, ownerPreview } = useSalon();
  return (
    <div data-testid="context-probe">
      {JSON.stringify({ layout: bookingPage.layout, bookingTimeZone, ownerPreview })}
    </div>
  );
}

async function renderLayout(slug: string) {
  const element = await SlugTenantLayout({
    children: (
      <div data-testid="layout-children">
        <ContextProbe />
      </div>
    ),
    params: Promise.resolve({ locale: 'en', slug }),
  });
  render(<>{element}</>);
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: DRAFT_SALON_ID,
      name: 'Draft Salon',
      slug: DRAFT_SALON_SLUG,
      settings: {},
      freeSoloEnabled: true,
      publicationStatus: 'draft',
    },
    {
      id: PUBLISHED_SALON_ID,
      name: 'Published Salon',
      slug: PUBLISHED_SALON_SLUG,
      settings: PUBLISHED_SALON_SETTINGS,
      freeSoloEnabled: true,
      publicationStatus: 'published',
    },
    {
      id: OTHER_SALON_ID,
      name: 'Other Salon',
      slug: OTHER_SALON_SLUG,
      settings: {},
      freeSoloEnabled: true,
      publicationStatus: 'published',
    },
  ]);

  await db.insert(schema.adminUserSchema).values([
    { id: OWNER_ADMIN_ID, phoneE164: '+15551110001', name: 'Layout Owner', isSuperAdmin: false, clerkUserId: 'user_layout_owner' },
    { id: OTHER_OWNER_ADMIN_ID, phoneE164: '+15551110002', name: 'Other Owner', isSuperAdmin: false, clerkUserId: 'user_layout_other' },
    { id: SUPER_ADMIN_ID, phoneE164: '+15551110003', name: 'Sam Super', isSuperAdmin: true },
  ]);

  await db.insert(schema.adminSalonMembershipSchema).values([
    { adminId: OWNER_ADMIN_ID, salonId: DRAFT_SALON_ID, role: 'owner' },
    { adminId: OWNER_ADMIN_ID, salonId: PUBLISHED_SALON_ID, role: 'owner' },
    { adminId: OTHER_OWNER_ADMIN_ID, salonId: OTHER_SALON_ID, role: 'owner' },
  ]);

  await db.insert(schema.adminSessionSchema).values([
    { id: OWNER_SESSION_ID, adminId: OWNER_ADMIN_ID, expiresAt: FAR_FUTURE },
    { id: OTHER_OWNER_SESSION_ID, adminId: OTHER_OWNER_ADMIN_ID, expiresAt: FAR_FUTURE },
    { id: SUPER_ADMIN_SESSION_ID, adminId: SUPER_ADMIN_ID, expiresAt: FAR_FUTURE },
    { id: EXPIRED_OWNER_SESSION_ID, adminId: OWNER_ADMIN_ID, expiresAt: PAST },
  ]);
}, 60_000);

beforeEach(() => {
  clearCookies();
  clerkContext.ready = false;
  clerkContext.userId = null;
  clerkContext.auth.mockReset();
  clerkContext.middleware.mockReset();
  clerkContext.intl.mockReset();
  clerkContext.intl.mockImplementation(() => NextResponse.next());
  clerkContext.middleware.mockImplementation((handler: (auth: unknown, req: NextRequest) => NextResponse | Promise<NextResponse>) => async (incoming: NextRequest) => {
    clerkContext.ready = true;
    return handler(clerkContext.auth, incoming);
  });
  clerkContext.auth.mockImplementation(async () => {
    if (!clerkContext.ready) {
      throw new Error('Clerk request context was not established');
    }
    return { userId: clerkContext.userId };
  });
  notFound.mockReset();
  notFound.mockImplementation(() => {
    throw NOT_FOUND_SENTINEL;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
});

describe('SlugTenantLayout — draft salon 404 gate', () => {
  it('1. anonymous access to a draft salon calls notFound', async () => {
    await expect(renderLayout(DRAFT_SALON_SLUG)).rejects.toThrow(NOT_FOUND_SENTINEL);

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('2. wrong owner (authenticated owner of a different salon) calls notFound', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OTHER_OWNER_SESSION_ID);

    await expect(renderLayout(DRAFT_SALON_SLUG)).rejects.toThrow(NOT_FOUND_SENTINEL);

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('3. revoked/expired owner session calls notFound', async () => {
    setCookie(ADMIN_SESSION_COOKIE, REVOKED_SESSION_ID);

    await expect(renderLayout(DRAFT_SALON_SLUG)).rejects.toThrow(NOT_FOUND_SENTINEL);

    expect(notFound).toHaveBeenCalledTimes(1);

    notFound.mockClear();
    setCookie(ADMIN_SESSION_COOKIE, EXPIRED_OWNER_SESSION_ID);

    await expect(renderLayout(DRAFT_SALON_SLUG)).rejects.toThrow(NOT_FOUND_SENTINEL);

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('4. correct owner sees the draft salon, with ownerPreview context threaded through — no banner from the layout itself', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OWNER_SESSION_ID);

    await renderLayout(DRAFT_SALON_SLUG);

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByTestId('layout-children')).toBeInTheDocument();

    // The layout resolves the gate but does not render PreviewBanner itself
    // — PublicSalonPageShell is the single banner owner (see fix note in
    // layout.tsx and the real-nested-route coverage in
    // [locale]/[slug]/book/service/page.test.tsx). A stub child, as used
    // here, never mounts PublicSalonPageShell, so no banner is expected in
    // this test.
    expect(screen.queryByTestId('owner-preview-banner')).not.toBeInTheDocument();

    const probe = JSON.parse(screen.getByTestId('context-probe').textContent ?? '{}');

    expect(probe.ownerPreview).toEqual({ isPreviewing: true, actorType: 'owner' });
  });

  it('5. authorized impersonating super admin bypasses the 404 and sees the draft salon', async () => {
    setCookie(ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_ID);
    setCookie(
      IMPERSONATE_COOKIE,
      impersonationCookieFor(DRAFT_SALON_ID, DRAFT_SALON_SLUG, SUPER_ADMIN_ID),
    );

    await renderLayout(DRAFT_SALON_SLUG);

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.queryByTestId('owner-preview-banner')).not.toBeInTheDocument();

    const probe = JSON.parse(screen.getByTestId('context-probe').textContent ?? '{}');

    expect(probe.ownerPreview).toEqual({ isPreviewing: true, actorType: 'super_admin' });
  });

  it('a super admin impersonating a DIFFERENT salon still gets notFound for this one (cross-tenant guard)', async () => {
    setCookie(ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_ID);
    setCookie(
      IMPERSONATE_COOKIE,
      impersonationCookieFor(OTHER_SALON_ID, OTHER_SALON_SLUG, SUPER_ADMIN_ID),
    );

    await expect(renderLayout(DRAFT_SALON_SLUG)).rejects.toThrow(NOT_FOUND_SENTINEL);

    expect(notFound).toHaveBeenCalledTimes(1);
  });
});

describe('SlugTenantLayout — draft bookingPage config on an already-published salon', () => {
  it('an anonymous visitor on a published salon never 404s and gets the LIVE bookingPage side, no banner', async () => {
    await renderLayout(PUBLISHED_SALON_SLUG);

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.queryByTestId('owner-preview-banner')).not.toBeInTheDocument();

    const probe = JSON.parse(screen.getByTestId('context-probe').textContent ?? '{}');

    expect(probe.layout).toBe('quick_book');
    expect(probe.bookingTimeZone).toBe('America/Vancouver');
    expect(probe.ownerPreview).toEqual({ isPreviewing: false, actorType: null });

    // The compact confirmation view scopes its utility-link suppression to a
    // confirmed receipt. The ordinary public footer remains fully reachable.
    const footer = screen.getByTestId('public-salon-footer');

    expect(footer).toHaveTextContent('Free booking by Luster');
    expect(footer.querySelectorAll('[data-footer-utility]')).toHaveLength(4);
    expect(footer.querySelector('[data-footer-utility][href*="find-booking"]')).toBeInTheDocument();
  });

  it('the correct owner previewing a published salon sees the DRAFT config, with ownerPreview context threaded through — no banner from the layout itself', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OWNER_SESSION_ID);

    await renderLayout(PUBLISHED_SALON_SLUG);

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.queryByTestId('owner-preview-banner')).not.toBeInTheDocument();

    const probe = JSON.parse(screen.getByTestId('context-probe').textContent ?? '{}');

    expect(probe.layout).toBe('editorial');
    expect(probe.ownerPreview).toEqual({ isPreviewing: true, actorType: 'owner' });
  });
});

describe('public middleware composed with the real tenant layout and authorization gate', () => {
  async function runMiddleware(path: string, origin = 'https://www.lustergel.app') {
    const request = new NextRequest(new URL(path, origin));
    for (const [name, cookie] of cookieJar) {
      request.cookies.set(name, cookie.value);
    }
    return middleware(request, {} as never);
  }

  async function requestLayout(slug: string, path = `/en/${slug}`, origin?: string) {
    const response = await runMiddleware(path, origin);

    expect(clerkContext.middleware).toHaveBeenCalledOnce();
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');

    await renderLayout(slug);
    return response;
  }

  it.each(['__session', '__session_XxiNjKcO'])('lets the verified matching owner preview an unpublished salon using %s', async (cookieName) => {
    setCookie(cookieName, 'opaque-owner-token');
    clerkContext.userId = 'user_layout_owner';
    await requestLayout(DRAFT_SALON_SLUG);

    expect(clerkContext.auth).toHaveBeenCalledOnce();
    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"isPreviewing":true');
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"actorType":"owner"');
    expect(screen.getAllByTestId('clerk-session-renewal')).toHaveLength(1);
  });

  it.each(['', '/en', '/fr'])('selects the matching owner’s draft config through the %s locale prefix', async (prefix) => {
    setCookie('__session', 'opaque-owner-token');
    clerkContext.userId = 'user_layout_owner';
    await requestLayout(PUBLISHED_SALON_SLUG, `${prefix}/${PUBLISHED_SALON_SLUG}/book/service`);

    expect(screen.getByTestId('context-probe')).toHaveTextContent('"layout":"editorial"');
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"isPreviewing":true');
  });

  it('does not turn a verified owner of another salon into a preview owner', async () => {
    setCookie('__session', 'opaque-other-owner-token');
    clerkContext.userId = 'user_layout_other';
    await requestLayout(PUBLISHED_SALON_SLUG);

    expect(screen.getByTestId('context-probe')).toHaveTextContent('"layout":"quick_book"');
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"isPreviewing":false');
  });

  it('still denies a different salon’s verified owner access to an unpublished salon', async () => {
    setCookie('__session', 'opaque-other-owner-token');
    clerkContext.userId = 'user_layout_other';

    await expect(requestLayout(DRAFT_SALON_SLUG)).rejects.toThrow(NOT_FOUND_SENTINEL);

    expect(notFound).toHaveBeenCalledOnce();
  });

  it.each(['expired-token', 'forged-token'])('uses live config when the SDK rejects %s rather than trusting cookie presence', async (token) => {
    setCookie('__session', token);
    await requestLayout(PUBLISHED_SALON_SLUG);

    expect(clerkContext.auth).toHaveBeenCalledOnce();
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"layout":"quick_book"');
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"isPreviewing":false');
  });

  it.each(['expired-token', 'forged-token'])('keeps an unpublished salon private when the SDK rejects %s', async (token) => {
    setCookie('__session', token);

    await expect(requestLayout(DRAFT_SALON_SLUG)).rejects.toThrow(NOT_FOUND_SENTINEL);

    expect(clerkContext.auth).toHaveBeenCalledOnce();
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('preserves verified owner context across a tenant-subdomain rewrite', async () => {
    vi.stubEnv('LUSTER_ROOT_DOMAIN', 'lustergel.app');
    vi.stubEnv('TENANT_SUBDOMAIN_ALLOWLIST', PUBLISHED_SALON_SLUG);
    setCookie('__session', 'opaque-owner-token');
    clerkContext.userId = 'user_layout_owner';
    const origin = `https://${PUBLISHED_SALON_SLUG}.lustergel.app`;
    const response = await requestLayout(PUBLISHED_SALON_SLUG, '/fr/book/service?source=fixture', origin);

    expect(response.headers.get('x-middleware-rewrite')).toBe(`${origin}/fr/${PUBLISHED_SALON_SLUG}/book/service?source=fixture`);
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"layout":"editorial"');
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"isPreviewing":true');
  });

  it('keeps a valid legacy owner session usable even with a stale Clerk cookie', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OWNER_SESSION_ID);
    setCookie('__session', 'stale-token');
    const response = await runMiddleware(`/${PUBLISHED_SALON_SLUG}`);
    await renderLayout(PUBLISHED_SALON_SLUG);

    expect(clerkContext.middleware).not.toHaveBeenCalled();
    expect(clerkContext.auth).not.toHaveBeenCalled();
    expect(screen.queryByTestId('clerk-session-renewal')).not.toBeInTheDocument();
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"layout":"editorial"');
    expect(screen.getByTestId('context-probe')).toHaveTextContent('"isPreviewing":true');
  });
});
