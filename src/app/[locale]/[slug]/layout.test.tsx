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
 * src/libs/bookingQuote.addOnGating.test.ts) — only the DB module, the
 * dev-role override, and the cookie jar are mocked. `resolveOwnerPreviewContext`
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
import React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

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
    { id: OWNER_ADMIN_ID, phoneE164: '+15551110001', name: 'Layout Owner', isSuperAdmin: false },
    { id: OTHER_OWNER_ADMIN_ID, phoneE164: '+15551110002', name: 'Other Owner', isSuperAdmin: false },
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
  notFound.mockReset();
  notFound.mockImplementation(() => {
    throw NOT_FOUND_SENTINEL;
  });
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
