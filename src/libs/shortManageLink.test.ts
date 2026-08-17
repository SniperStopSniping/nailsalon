/**
 * Short manage links — alias security proofs: entropy/format, digest-only
 * storage, expiry/revocation, cross-tenant safety, enumeration resistance.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  LUSTER_SHORT_LINK_ORIGIN: undefined as string | undefined,
}));

vi.mock('@/libs/Env', () => ({ Env: envHolder }));

let db: ReturnType<typeof drizzle<typeof schema>>;

const NOW = new Date('2026-08-17T12:00:00.000Z');
const FUTURE = new Date('2026-09-17T12:00:00.000Z');

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values({ id: 'sl1', name: 'Link Salon', slug: 'link-salon' });
  await db.insert(schema.appointmentSchema).values({
    id: 'apt_sl1',
    salonId: 'sl1',
    clientName: 'C',
    clientPhone: '4165550000',
    startTime: FUTURE,
    endTime: new Date(FUTURE.getTime() + 3600000),
    status: 'confirmed',
    totalPrice: 50,
    totalDurationMinutes: 60,
  });
});

describe('shortManageLink', () => {
  it('mints 22-char base64url tokens (128-bit) and stores ONLY the digest', async () => {
    const { mintShortManageToken } = await import('./shortManageLink');
    const minted = await db.transaction(async tx =>
      mintShortManageToken(tx, { salonId: 'sl1', appointmentId: 'apt_sl1', expiresAt: FUTURE }));

    expect(minted.token).toMatch(/^[\w-]{22}$/);
    expect(minted.url).toBe(`https://islanailsalon.com/a/${minted.token}`);

    const raw = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM appointment_access_token WHERE token_hash = ${minted.token}
    `);

    expect(Number((raw.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('resolves a live token, and returns the IDENTICAL opaque failure for expired, revoked and unknown', async () => {
    const { mintShortManageToken, resolveShortManageToken } = await import('./shortManageLink');
    const { hashOpaqueToken } = await import('./lusterSecurity');
    const live = await db.transaction(async tx =>
      mintShortManageToken(tx, { salonId: 'sl1', appointmentId: 'apt_sl1', expiresAt: FUTURE }));
    const expired = await db.transaction(async tx =>
      mintShortManageToken(tx, { salonId: 'sl1', appointmentId: 'apt_sl1', expiresAt: new Date(NOW.getTime() - 1000) }));
    const revoked = await db.transaction(async tx =>
      mintShortManageToken(tx, { salonId: 'sl1', appointmentId: 'apt_sl1', expiresAt: FUTURE }));
    await db.execute(sql`
      UPDATE appointment_access_token SET revoked_at = ${NOW} WHERE token_hash = ${hashOpaqueToken(revoked.token)}
    `);

    expect(await resolveShortManageToken(db, live.token, NOW))
      .toEqual({ ok: true, salonSlug: 'link-salon', appointmentId: 'apt_sl1' });
    expect(await resolveShortManageToken(db, expired.token, NOW)).toEqual({ ok: false });
    expect(await resolveShortManageToken(db, revoked.token, NOW)).toEqual({ ok: false });
    expect(await resolveShortManageToken(db, 'A'.repeat(22), NOW)).toEqual({ ok: false });
    expect(await resolveShortManageToken(db, 'short', NOW)).toEqual({ ok: false });
    expect(await resolveShortManageToken(db, 'not/base64url!', NOW)).toEqual({ ok: false });
  });

  it('enforces the one-segment origin budget and rejects salon custom domains by construction', async () => {
    const { resolveShortLinkOrigin, SHORT_LINK_MAX_ORIGIN_LENGTH } = await import('./shortManageLink');

    expect(resolveShortLinkOrigin().length).toBeLessThanOrEqual(SHORT_LINK_MAX_ORIGIN_LENGTH);

    envHolder.LUSTER_SHORT_LINK_ORIGIN = 'https://lstr.to';

    expect(resolveShortLinkOrigin()).toBe('https://lstr.to');

    envHolder.LUSTER_SHORT_LINK_ORIGIN = undefined;

    // No code path consults salon.customDomain: source scan.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./shortManageLink.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('customDomain');
    expect(source).not.toContain('getSalonPublicBaseUrl');
  });

  it('the /a route redirects same-origin 302 with no-store and identical opaque failures', async () => {
    const { mintShortManageToken } = await import('./shortManageLink');
    const minted = await db.transaction(async tx =>
      mintShortManageToken(tx, { salonId: 'sl1', appointmentId: 'apt_sl1', expiresAt: FUTURE }));
    const { GET } = await import('../app/a/[token]/route');

    const ok = await GET(
      new Request('https://islanailsalon.com/a/x', { headers: { 'x-forwarded-for': '10.9.0.1' } }),
      { params: Promise.resolve({ token: minted.token }) },
    );

    expect(ok.status).toBe(302);
    expect(ok.headers.get('Location')).toBe(`/en/link-salon/manage/${minted.token}`);
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect(ok.headers.get('Referrer-Policy')).toBe('no-referrer');

    const unknown = await GET(
      new Request('https://islanailsalon.com/a/x', { headers: { 'x-forwarded-for': '10.9.0.2' } }),
      { params: Promise.resolve({ token: 'B'.repeat(22) }) },
    );

    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe('This link is no longer valid.');
  });

  it('reserves the \'a\' public segment so no salon can claim it', async () => {
    const { isValidSalonSlug } = await import('./tenantSlug');

    expect(isValidSalonSlug('a')).toBe(false);
  });
});
